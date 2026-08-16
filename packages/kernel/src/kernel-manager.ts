import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HostRequest {
  requestId: string;
  request: { kind: string; [key: string]: unknown };
}

export interface KernelError {
  type: string;
  message: string;
  traceback: string[];
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  resultRepr: string | null;
  error: KernelError | null;
  durationMs: number;
}

export interface KernelOptions {
  /** Python interpreter; defaults to `python3`. */
  pythonPath: string | undefined;
  /** Directory containing the `deep_agent_runtime` package; auto-derived from this module. */
  runtimeDir: string | undefined;
  sessionId: string;
  sessionDir: string;
  workspaceDir: string;
  /** Per-cell timeout in ms; 0 disables (POSIX only, SIGALRM-based). */
  execTimeoutMs: number | undefined;
  /**
   * Handler for kernel-side host requests (rlm child spawns, goals, messages).
   * Resolving writes the payload back to the kernel; a rejected promise sends
   * its message as the error.
   */
  onHostRequest: ((request: HostRequest) => Promise<unknown>) | undefined;
  /** Raw kernel stdout lines that are not protocol messages (diagnostics). */
  onRawLine: ((line: string) => void) | undefined;
}

interface PendingExec {
  resolve: (result: ExecResult) => void;
  reject: (error: Error) => void;
}

interface KernelLine {
  type?: string;
  id?: string;
  request_id?: string;
  [key: string]: unknown;
}

function defaultRuntimeDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, '..', '..', '..', 'python');
  if (existsSync(join(candidate, 'deep_agent_runtime', '__init__.py'))) return candidate;
  throw new Error(
    `could not locate the deep_agent_runtime Python package near ${here}; set options.runtimeDir`,
  );
}

/**
 * Owns one persistent Python kernel process speaking the deep-agent JSON-lines
 * protocol. Execution is programmatic: `exec` runs a cell in the kernel's
 * durable namespace, and kernel-side host requests (spawning children, goals,
 * messaging) are surfaced through `onHostRequest` while the cell blocks.
 */
export class KernelManager {
  readonly sessionId: string;
  private readonly options: Required<Pick<KernelOptions, 'pythonPath' | 'runtimeDir'>> &
    KernelOptions;
  private child: ChildProcess | null = null;
  private buffer = '';
  private pending = new Map<string, PendingExec>();
  private execCounter = 0;
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private started = false;
  private exited = false;
  private disposed = false;

  constructor(options: KernelOptions) {
    this.sessionId = options.sessionId;
    this.options = {
      ...options,
      pythonPath: options.pythonPath ?? process.env.DEEP_AGENT_PYTHON ?? 'python3',
      runtimeDir: options.runtimeDir ?? defaultRuntimeDir(),
    };
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { pythonPath, runtimeDir, sessionId, sessionDir, workspaceDir, execTimeoutMs } =
      this.options;
    const env = {
      ...process.env,
      PYTHONPATH: [runtimeDir, process.env.PYTHONPATH].filter(Boolean).join(':'),
      PYTHONUNBUFFERED: '1',
    };
    const args = [
      '-m',
      'deep_agent_runtime',
      '--session-id',
      sessionId,
      '--session-dir',
      sessionDir,
      '--workspace-dir',
      workspaceDir,
      '--exec-timeout-ms',
      String(execTimeoutMs ?? 0),
    ];
    const child = spawn(String(pythonPath), args, {
      cwd: workspaceDir,
      env,
      stdio: ['pipe', 'pipe', 'inherit'] as const,
    });
    this.child = child;
    this.buffer = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consume(chunk));
    child.on('error', (error) => {
      this.readyReject(new Error(`kernel process error: ${error.message}`));
      this.failAll(new Error(`kernel process error: ${error.message}`));
    });
    child.on('exit', (code, signal) => {
      this.exited = true;
      this.readyReject(new Error(`kernel exited before ready (code=${code}, signal=${signal})`));
      this.failAll(new Error(`kernel process exited (code=${code}, signal=${signal})`));
      this.child = null;
    });
    await Promise.race([
      this.readyPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('kernel did not become ready within 15s')), 15000),
      ),
    ]);
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let message: KernelLine;
    try {
      message = JSON.parse(line) as KernelLine;
    } catch {
      this.options.onRawLine?.(line);
      return;
    }
    switch (message.type) {
      case 'ready':
        this.readyResolve();
        break;
      case 'result': {
        const id = typeof message.id === 'string' ? message.id : '';
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.resolve({
          stdout: String(message.stdout ?? ''),
          stderr: String(message.stderr ?? ''),
          resultRepr: typeof message.result_repr === 'string' ? message.result_repr : null,
          error: (message.error as KernelError | undefined) ?? null,
          durationMs: Number(message.duration_ms ?? 0),
        });
        break;
      }
      case 'host_request': {
        const requestId =
          typeof message.request_id === 'string' ? message.request_id : '';
        const request = (message.request ?? { kind: 'unknown' }) as HostRequest['request'];
        void this.answerHostRequest(requestId, request);
        break;
      }
      default:
        this.options.onRawLine?.(line);
    }
  }

  private async answerHostRequest(
    requestId: string,
    request: HostRequest['request'],
  ): Promise<void> {
    try {
      const payload = await this.options.onHostRequest?.({ requestId, request });
      this.write({ type: 'host_response', request_id: requestId, payload: payload ?? null });
    } catch (error) {
      this.write({
        type: 'host_response',
        request_id: requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private write(message: unknown): void {
    if (!this.child) throw new Error('kernel not started');
    this.child.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  /** Execute one cell of Python in the kernel's persistent namespace. */
  async exec(code: string): Promise<ExecResult> {
    if (this.exited) throw new Error('kernel process exited');
    if (!this.child) throw new Error('kernel not started');
    const id = `exec-${++this.execCounter}-${Date.now()}`;
    const promise = new Promise<ExecResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.write({ type: 'exec', id, code });
    return promise;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  /** Stop the kernel: graceful shutdown message, then SIGKILL after a grace period. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const child = this.child;
    this.exited = true;
    if (!child) return;
    this.child = null;
    this.failAll(new Error('kernel disposed'));
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      child.stdin?.write(JSON.stringify({ type: 'shutdown' }) + '\n');
    } catch {
      // stdin already gone; fall through to kill
    }
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    const grace = new Promise<void>((resolve) =>
      setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2000),
    );
    await Promise.race([exited, grace]);
  }
}
