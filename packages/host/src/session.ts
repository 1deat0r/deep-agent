import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import type { ChatMessage, LlmClient, ToolCall } from '@deep-agent/provider';
import { KernelManager, type ExecResult, type HostRequest } from '@deep-agent/kernel';
import { IPYTHON_TOOL } from './types.js';
import type {
  ChildSummary,
  GoalState,
  HostConfig,
  SessionMeta,
  SessionRole,
  SessionStatus,
  TranscriptEntry,
} from './types.js';
import { EventBus } from './events.js';
import { SkillsRegistry } from './skills.js';
import { SessionStore } from './store.js';
import { systemPrompt } from './system-prompt.js';

export interface SessionDeps {
  store: SessionStore;
  events: EventBus;
  config: HostConfig;
  skills: SkillsRegistry;
  /** Client factory, given the session role (root or child). */
  createClient: (ctx: { role: SessionRole }) => LlmClient;
  host: SessionHost;
}

/** Capabilities the session delegates upward to the manager. */
export interface SessionHost {
  spawnChild(
    parent: AgentSession,
    prompt: string,
    name?: string,
  ): Promise<{ child_id: string; name: string; session_dir: string; model: string }>;
  listChildren(parent: AgentSession): ChildSummary[];
  deleteChild(parent: AgentSession, nameOrId: string): Promise<void>;
  routeMessage(
    from: AgentSession,
    payload: { message: string; receiver_role: string; receiver_name?: string },
  ): Promise<void>;
}

export interface TurnInput {
  content: string;
  /** Named source, e.g. a child agent or 'system' for continuations. */
  name?: string;
  /** Continuation rounds of an active goal bump this counter. */
  goalRound?: boolean;
}

export interface TurnResult {
  ok: boolean;
  summary: string;
  error?: string;
}

const MAX_TOOL_RESULT_CHARS = 16_000;

const COMPACTION_PROMPT =
  'You are compacting a conversation for a context handoff. Summarize the conversation below so a fresh agent can continue seamlessly. Preserve: the current objective, decisions made and why, the state of files in the workspace, open questions, and exactly what remains to be done. Drop verbatim tool output, cell code, and pleasantries. Write only the summary.';

function formatToolResult(result: ExecResult): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(`[stdout]\n${result.stdout}`);
  if (result.stderr) parts.push(`[stderr]\n${result.stderr}`);
  if (result.resultRepr !== null) parts.push(`[result]\n${result.resultRepr}`);
  if (result.error) {
    parts.push(`[error]\n${result.error.message}`);
    if (result.error.traceback.length > 0) {
      parts.push(result.error.traceback.slice(0, 25).join('\n'));
    }
  }
  const text = parts.join('\n\n') || '[no output]';
  return text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n...[truncated]`
    : text;
}

function newGoal(objective: string, maxRounds: number): GoalState {
  return {
    objective,
    status: 'active',
    rounds: 0,
    maxRounds,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * One agent session: an LLM conversation, a persistent kernel, child
 * subagents, and an optional goal — the unit of the RLM loop. Turns are
 * serialized through a promise chain so child replies and continuations queue
 * safely behind an in-flight turn.
 */
export class AgentSession {
  readonly id: string;
  meta: SessionMeta;
  transcript: TranscriptEntry[];
  kernel: KernelManager | null = null;
  private readonly deps: SessionDeps;
  private chain: Promise<void> = Promise.resolve();
  private abort: AbortController | null = null;
  private disposed = false;
  private continuationScheduled = false;
  private continuationTimer: NodeJS.Timeout | null = null;
  private pauseAfterTurn = false;

  private constructor(meta: SessionMeta, transcript: TranscriptEntry[], deps: SessionDeps) {
    this.id = meta.id;
    this.meta = meta;
    this.transcript = transcript;
    this.deps = deps;
  }

  static async create(
    deps: SessionDeps,
    options: {
      title: string | undefined;
      role: SessionRole | undefined;
      parentId: string | null | undefined;
      depth: number | undefined;
      goal: string | null | undefined;
      autoContinue: boolean | undefined;
    },
  ): Promise<AgentSession> {
    const now = new Date().toISOString();
    const meta: SessionMeta = {
      id: randomUUID(),
      title: options.title ?? 'New session',
      role: options.role ?? 'root',
      parentId: options.parentId ?? null,
      depth: options.depth ?? 0,
      model: deps.config.provider.model,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
      childIds: [],
      goal: options.goal ? newGoal(options.goal, deps.config.maxAutoRounds) : null,
      autoContinue: options.autoContinue ?? false,
    };
    deps.store.saveMeta(meta);
    return new AgentSession(meta, [], deps);
  }

  static load(deps: SessionDeps, id: string): AgentSession | null {
    const meta = deps.store.loadMeta(id);
    if (!meta) return null;
    return new AgentSession(meta, deps.store.loadTranscript(id), deps);
  }

  // -- public surface ------------------------------------------------------

  get status(): SessionStatus {
    return this.meta.status;
  }

  get workspaceDir(): string {
    return this.deps.store.workspaceFor(this.id);
  }

  get sessionDir(): string {
    return this.deps.store.dirFor(this.id);
  }

  setStatus(status: SessionStatus): void {
    this.meta.status = status;
    this.touch();
    this.deps.events.emit({ type: 'status', sessionId: this.id, status });
  }

  runTurn(input: TurnInput): Promise<TurnResult> {
    const result = this.chain.then(() => this.doRunTurn(input));
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async interrupt(): Promise<void> {
    this.abort?.abort();
  }

  /** Manual kernel console execution (used by the web console). */
  async execConsole(code: string): Promise<ExecResult> {
    return (await this.ensureKernel()).exec(code);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.abort?.abort();
    await this.kernel?.dispose();
    this.kernel = null;
  }

  // -- the RLM turn loop ---------------------------------------------------

  private async doRunTurn(input: TurnInput): Promise<TurnResult> {
    if (this.disposed) return { ok: false, summary: '', error: 'session disposed' };
    // A direct user message (no name) while a goal continuation is pending
    // pauses the autonomous loop after this turn; child replies and system
    // continuations do not pause it.
    if (input.name === undefined && this.continuationTimer) {
      clearTimeout(this.continuationTimer);
      this.continuationTimer = null;
      this.continuationScheduled = false;
      this.pauseAfterTurn = true;
    }
    if (input.goalRound && this.meta.goal) {
      this.meta.goal.rounds += 1;
      this.meta.goal.updatedAt = new Date().toISOString();
      this.persistGoal();
    }

    if (input.content.trim() !== '') {
      this.append({
        kind: 'message',
        role: 'user',
        content: input.content,
        ...(input.name ? { name: input.name } : {}),
      });
    }

    const turnId = randomUUID();
    this.setStatus('running');
    this.deps.events.emit({ type: 'turn_start', sessionId: this.id, turnId });
    this.abort = new AbortController();
    const client = this.deps.createClient({ role: this.meta.role });

    await this.ensureCompacted(client);
    const messages: ChatMessage[] = this.buildTurnMessages();

    let finalText = '';
    try {
      for (let iteration = 0; iteration < this.deps.config.maxToolIterations; iteration++) {
        if (this.abort.signal.aborted) {
          finalText = '(interrupted by user)';
          break;
        }
        const assistant = await this.runLlmCall(client, messages, turnId, this.abort.signal);
        this.append({ kind: 'message', ...assistant });
        this.deps.events.emit({
          type: 'message_complete',
          sessionId: this.id,
          message: { kind: 'message', ...assistant },
        });
        messages.push(assistant);

        const calls = assistant.tool_calls ?? [];
        if (calls.length === 0) {
          finalText = assistant.content ?? '(no response)';
          break;
        }

        for (const call of calls) {
          messages.push(await this.executeToolCall(call));
        }
      }
      if (finalText === '') finalText = '(tool iteration limit reached)';
      return this.finishTurn(turnId, finalText, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.events.emit({ type: 'error', sessionId: this.id, message });
      return this.finishTurn(turnId, '', message);
    } finally {
      this.abort = null;
    }
  }

  private finishTurn(turnId: string, summary: string, error: string | null): TurnResult {
    const trimmed = summary.trim().slice(0, 4000);
    if (error === null && trimmed !== '') this.meta.lastSummary = trimmed;
    this.meta.status = 'idle';
    this.touch();
    this.deps.events.emit({ type: 'status', sessionId: this.id, status: 'idle' });
    this.deps.events.emit({ type: 'turn_end', sessionId: this.id, turnId, summary: trimmed });
    if (error === null) this.scheduleContinuationIfDue();
    return { ok: error === null, summary: trimmed, ...(error ? { error } : {}) };
  }

  private scheduleContinuationIfDue(): void {
    if (this.pauseAfterTurn) {
      this.pauseAfterTurn = false;
      this.meta.autoContinue = false;
      this.touch();
      return;
    }
    const goal = this.meta.goal;
    if (!goal || !this.meta.autoContinue || this.continuationScheduled || this.disposed) return;
    if (goal.status !== 'active') return;
    if (goal.rounds >= goal.maxRounds) {
      goal.status = 'blocked';
      goal.blockedReason = `round limit reached (${goal.maxRounds})`;
      goal.updatedAt = new Date().toISOString();
      this.persistGoal();
      return;
    }
    this.continuationScheduled = true;
    this.continuationTimer = setTimeout(() => {
      this.continuationScheduled = false;
      this.continuationTimer = null;
      if (this.disposed || this.meta.goal?.status !== 'active' || !this.meta.autoContinue) return;
      void this.runTurn({
        content: `Goal continuation round ${this.meta.goal.rounds + 1}/${this.meta.goal.maxRounds}: continue working toward the objective. Inspect current state, do the next increment of work, then report progress.`,
        name: 'system',
        goalRound: true,
      }).catch((error) => {
        this.deps.events.emit({
          type: 'error',
          sessionId: this.id,
          message: `continuation failed: ${(error as Error).message}`,
        });
      });
    }, 250);
  }

  // -- compaction ----------------------------------------------------------

  private messageChars(messages: ChatMessage[]): number {
    let total = 0;
    for (const message of messages) {
      total += (message.content ?? '').length;
      for (const call of message.tool_calls ?? []) {
        total += call.function.name.length + call.function.arguments.length;
      }
    }
    return total;
  }

  private renderPrefix(messages: ChatMessage[]): string {
    const lines = messages.slice(-40).map((message) => {
      const who = message.name ? `${message.role}(${message.name})` : message.role;
      const text =
        message.role === 'tool'
          ? `[tool result: ${(message.content ?? '').slice(0, 500)}]`
          : (message.content ?? '');
      return `[${who}] ${text}`;
    });
    const body = lines.join('\n\n');
    return body.length > 30_000 ? body.slice(-30_000) : body;
  }

  /**
   * When the transcript outgrows `compactAtChars`, summarize everything before
   * the recent keep-window and append a compaction entry to the transcript.
   * History is never rewritten — the marker is append-only and context
   * rebuilds deterministically from it on resume.
   */
  private async ensureCompacted(client: LlmClient): Promise<void> {
    // Only messages after the last compaction marker are part of the context;
    // measuring the whole transcript would re-summarize already-compacted
    // history on every turn.
    let lastCompaction = -1;
    for (let i = this.transcript.length - 1; i >= 0; i--) {
      if (this.transcript[i]?.kind === 'compaction') {
        lastCompaction = i;
        break;
      }
    }
    const all = SessionStore.messagesFrom(this.transcript.slice(lastCompaction + 1));
    if (this.messageChars(all) <= this.deps.config.compactAtChars) return;

    let keepStart = all.length;
    let keepChars = 0;
    for (let i = all.length - 1; i >= 0; i--) {
      const message = all[i];
      if (!message) break;
      const chars =
        (message.content ?? '').length +
        (message.tool_calls ?? []).reduce((n, call) => n + call.function.arguments.length, 0);
      if (keepChars > 0 && keepChars + chars > this.deps.config.compactKeepChars) break;
      keepChars += chars;
      keepStart = i;
    }
    const prefix = all.slice(0, keepStart);
    if (prefix.length === 0) return;

    let summary = '';
    try {
      for await (const chunk of client.streamChat([
        { role: 'system', content: COMPACTION_PROMPT },
        { role: 'user', content: this.renderPrefix(prefix) },
      ])) {
        if (chunk.type === 'delta') summary += chunk.content;
        if (chunk.type === 'error') throw new Error(chunk.message);
        if (chunk.type === 'done') break;
      }
    } catch {
      // Summarization is best-effort: on failure, proceed with the full context.
      return;
    }
    if (summary.trim() === '') return;
    // The marker is append-only and lands at the transcript tail, so it must
    // carry the cut position: the transcript index of the first kept message.
    let messageCount = 0;
    let from = this.transcript.length;
    for (let i = lastCompaction + 1; i < this.transcript.length; i++) {
      const entry = this.transcript[i];
      if (entry?.kind !== 'message') continue;
      if (messageCount === keepStart) {
        from = i;
        break;
      }
      messageCount += 1;
    }
    this.append({
      kind: 'compaction',
      summary: summary.trim(),
      from,
      timestamp: new Date().toISOString(),
    });
  }

  private buildTurnMessages(): ChatMessage[] {
    const system: ChatMessage = {
      role: 'system',
      content: systemPrompt({
        sessionId: this.id,
        role: this.meta.role,
        workspaceDir: this.workspaceDir,
        parentName: this.parentName(),
        goalObjective: this.meta.goal?.objective ?? null,
        skills: this.deps.skills.list(),
      }),
    };
    let lastCompaction = -1;
    for (let i = this.transcript.length - 1; i >= 0; i--) {
      if (this.transcript[i]?.kind === 'compaction') {
        lastCompaction = i;
        break;
      }
    }
    if (lastCompaction === -1) {
      return [system, ...SessionStore.messagesFrom(this.transcript)];
    }
    const marker = this.transcript[lastCompaction] as Extract<
      TranscriptEntry,
      { kind: 'compaction' }
    >;
    const after = this.transcript
      .slice(marker.from)
      .filter((entry): entry is TranscriptEntry & { kind: 'message' } => entry.kind === 'message')
      .map(({ kind: _kind, ...message }) => message);
    return [
      system,
      { role: 'system', content: `[earlier conversation summary]\n${marker.summary}` },
      ...after,
    ];
  }

  // -- LLM call ------------------------------------------------------------

  private async runLlmCall(
    client: LlmClient,
    messages: ChatMessage[],
    turnId: string,
    signal: AbortSignal,
  ): Promise<ChatMessage> {
    let content = '';
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    for await (const chunk of client.streamChat(
      messages,
      [IPYTHON_TOOL],
      { signal },
    )) {
      switch (chunk.type) {
        case 'delta':
          content += chunk.content;
          this.deps.events.emit({
            type: 'message_delta',
            sessionId: this.id,
            turnId,
            delta: chunk.content,
          });
          break;
        case 'tool_call_delta': {
          const existing = toolCalls.get(chunk.index);
          if (existing) {
            if (chunk.id) existing.id = chunk.id;
            if (chunk.name) existing.name += chunk.name;
            if (chunk.arguments) existing.arguments += chunk.arguments;
          } else {
            toolCalls.set(chunk.index, {
              id: chunk.id ?? '',
              name: chunk.name ?? '',
              arguments: chunk.arguments ?? '',
            });
          }
          break;
        }
        case 'done':
          break;
        case 'error':
          throw new Error(chunk.message);
      }
    }
    const calls: ToolCall[] = [...toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.arguments },
      }));
    return {
      role: 'assistant',
      content: content === '' ? null : content,
      ...(calls.length > 0 ? { tool_calls: calls } : {}),
    };
  }

  // -- tool execution ------------------------------------------------------

  private async executeToolCall(call: ToolCall): Promise<ChatMessage> {
    const name = call.function.name;
    if (name !== 'ipython') {
      return {
        role: 'tool',
        tool_call_id: call.id,
        content: `error: unknown tool "${name}" — only "ipython" exists in this RLM runtime`,
      };
    }
    let code = '';
    try {
      code = String((JSON.parse(call.function.arguments || '{}') as { code?: unknown }).code ?? '');
    } catch {
      return {
        role: 'tool',
        tool_call_id: call.id,
        content: 'error: ipython arguments must be JSON with a "code" string',
      };
    }
    const kernel = await this.ensureKernel();
    const result = await kernel.exec(code);
    const cell: TranscriptEntry & { kind: 'cell' } = {
      kind: 'cell',
      code,
      stdout: result.stdout,
      stderr: result.stderr,
      resultRepr: result.resultRepr,
      error: result.error?.message ?? null,
      durationMs: result.durationMs,
      timestamp: new Date().toISOString(),
    };
    this.append(cell);
    this.deps.events.emit({ type: 'cell_result', sessionId: this.id, cell });
    const toolMessage: ChatMessage = {
      role: 'tool',
      tool_call_id: call.id,
      content: formatToolResult(result),
    };
    this.append({ kind: 'message', ...toolMessage });
    return toolMessage;
  }

  // -- kernel --------------------------------------------------------------

  private async ensureKernel(): Promise<KernelManager> {
    if (this.kernel && !this.kernel.isDisposed()) return this.kernel;
    const kernel = new KernelManager({
      sessionId: this.id,
      sessionDir: this.sessionDir,
      workspaceDir: this.workspaceDir,
      pythonPath: this.deps.config.pythonPath,
      runtimeDir: this.deps.config.pythonDir,
      execTimeoutMs: this.deps.config.execTimeoutMs,
      onHostRequest: (request) => this.handleHostRequest(request),
      onRawLine: undefined,
    });
    await kernel.start();
    this.kernel = kernel;
    return kernel;
  }

  private async handleHostRequest(request: HostRequest): Promise<unknown> {
    const payload = request.request;
    switch (payload.kind) {
      case 'spawn_child': {
        const prompt = String(payload.prompt ?? '');
        if (prompt === '') throw new Error('spawn_child requires a prompt');
        return this.deps.host.spawnChild(
          this,
          prompt,
          typeof payload.name === 'string' ? payload.name : undefined,
        );
      }
      case 'list_subagents':
        return this.deps.host.listChildren(this);
      case 'delete_subagent':
        await this.deps.host.deleteChild(this, String(payload.name_or_id ?? ''));
        return { ok: true };
      case 'send_message':
        await this.deps.host.routeMessage(this, {
          message: String(payload.message ?? ''),
          receiver_role: String(payload.receiver_role ?? 'parent'),
          ...(typeof payload.receiver_name === 'string'
            ? { receiver_name: payload.receiver_name }
            : {}),
        });
        return { ok: true };
      case 'skills_list':
        return this.deps.skills.list();
      case 'skills_load':
        return this.deps.skills.load(String(payload.name ?? ''));
      case 'skills_install': {
        // Relative paths are resolved against the session workspace: the
        // kernel's cwd, not the host process cwd.
        const raw = String(payload.source ?? '');
        const source = isAbsolute(raw) ? raw : join(this.workspaceDir, raw);
        return this.deps.skills.install(source);
      }
      case 'goal_create': {
        const objective = String(payload.objective ?? '').trim();
        if (objective === '') throw new Error('goal_create requires a non-empty objective');
        this.meta.goal = newGoal(objective, this.deps.config.maxAutoRounds);
        this.persistGoal();
        return this.meta.goal;
      }
      case 'goal_status':
        return this.meta.goal ?? { status: 'none' };
      case 'goal_complete': {
        if (!this.meta.goal) throw new Error('no active goal');
        this.meta.goal.status = 'completed';
        this.meta.goal.summary = String(payload.summary ?? '');
        this.meta.goal.updatedAt = new Date().toISOString();
        this.persistGoal();
        return this.meta.goal;
      }
      case 'goal_block': {
        if (!this.meta.goal) throw new Error('no active goal');
        this.meta.goal.status = 'blocked';
        this.meta.goal.blockedReason = String(payload.reason ?? '');
        this.meta.goal.updatedAt = new Date().toISOString();
        this.persistGoal();
        return this.meta.goal;
      }
      default:
        throw new Error(`unknown host request kind: ${String(payload.kind)}`);
    }
  }

  private persistGoal(): void {
    if (this.meta.goal) {
      this.meta.goal.updatedAt = new Date().toISOString();
    }
    this.touch();
    if (this.meta.goal) {
      this.deps.events.emit({ type: 'goal_updated', sessionId: this.id, goal: this.meta.goal });
    }
  }

  // -- transcript/meta helpers ----------------------------------------------

  append(entry: TranscriptEntry): void {
    if (this.disposed) return;
    this.transcript.push(entry);
    this.deps.store.appendTranscript(this.id, entry);
    this.touch();
  }

  touch(): void {
    if (this.disposed) return;
    this.meta.updatedAt = new Date().toISOString();
    this.deps.store.saveMeta(this.meta);
  }

  private parentName(): string | null {
    return this.meta.parentTitle ?? null;
  }
}
