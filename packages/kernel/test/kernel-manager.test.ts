import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KernelManager } from '../src/index.js';

let sessionRoot: string;
const kernels: KernelManager[] = [];

beforeEach(() => {
  sessionRoot = mkdtempSync(join(tmpdir(), 'deep-agent-kernel-'));
});

afterEach(async () => {
  await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

function makeKernel(extra: Partial<ConstructorParameters<typeof KernelManager>[0]> = {}) {
  const sessionDir = join(sessionRoot, 'session');
  const workspaceDir = join(sessionRoot, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  const kernel = new KernelManager({
    sessionId: 'test-session',
    sessionDir,
    workspaceDir,
    ...extra,
  });
  kernels.push(kernel);
  return { kernel, workspaceDir };
}

describe('KernelManager (real subprocess)', () => {
  it('starts, executes cells with persistent state, and disposes', async () => {
    const { kernel, workspaceDir } = makeKernel();
    await kernel.start();
    const first = await kernel.exec('total = 0\nx = [i * 2 for i in range(3)]');
    expect(first.error).toBeNull();
    const second = await kernel.exec('total + sum(x)');
    expect(second.error).toBeNull();
    expect(second.resultRepr).toBe('6');

    const pwd = await kernel.exec('import os\nos.getcwd()');
    expect(pwd.resultRepr).toContain(workspaceDir);

    const file = await kernel.exec(
      "from pathlib import Path\nPath('hello.txt').write_text('from the kernel')\n'written'",
    );
    expect(file.error).toBeNull();
    expect(file.resultRepr).toContain('written');
  });

  it('reports python errors with tracebacks', async () => {
    const { kernel } = makeKernel();
    await kernel.start();
    const result = await kernel.exec('1 / 0');
    expect(result.error?.type).toBe('ZeroDivisionError');
    expect(result.error?.traceback.join('\n')).toContain('ZeroDivisionError');
  });

  it('runs shell cell magics in the workspace', async () => {
    const { kernel, workspaceDir } = makeKernel();
    await kernel.start();
    const result = await kernel.exec('%%bash\necho magic-works\npwd\n');
    expect(result.stdout).toContain('magic-works');
    expect(result.stdout).toContain(workspaceDir);
    expect(result.error).toBeNull();
  });

  it('round-trips host requests (rlm spawn) while the cell blocks', async () => {
    const { kernel } = makeKernel({
      onHostRequest: async (req) => {
        expect(req.request.kind).toBe('spawn_child');
        return {
          handle: {
            child_id: 'c-42',
            name: req.request.name ?? 'unnamed',
            session_dir: '/somewhere/child',
          },
        };
      },
    });
    await kernel.start();
    const result = await kernel.exec(
      'handle = await rlm("review the flow", name="reviewer")\nhandle',
    );
    expect(result.error).toBeNull();
    expect(result.resultRepr).toContain('c-42');
  });

  it('surfaces host rejections as HostError in the cell', async () => {
    const { kernel } = makeKernel({
      onHostRequest: async () => {
        throw new Error('depth limit reached');
      },
    });
    await kernel.start();
    const result = await kernel.exec('await rlm("too deep")');
    expect(result.error?.type).toBe('HostError');
    expect(result.error?.message).toContain('depth limit reached');
  });

  it('writes files that are visible to the host', async () => {
    const { kernel, workspaceDir } = makeKernel();
    await kernel.start();
    await kernel.exec("Path('artifact.txt').write_text('artifact content')");
    const content = await kernel.exec("Path('artifact.txt').read_text()");
    expect(content.resultRepr).toContain('artifact content');
    // visible to the host filesystem too
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(workspaceDir, 'artifact.txt'), 'utf8')).toBe('artifact content');
  });

  it('fails fast when python is missing', async () => {
    const { kernel } = makeKernel({ pythonPath: '/nonexistent/python-interpreter' });
    await expect(kernel.start()).rejects.toThrow(/kernel/);
  });

  it('restarts a crashed kernel on the next exec and loses state', async () => {
    const restarts: string[] = [];
    const { kernel } = makeKernel({
      onRestart: (reason) => restarts.push(reason),
    });
    await kernel.start();
    await kernel.exec('x = 41');
    await expect(kernel.exec('import os\nos._exit(3)')).rejects.toThrow(/exited/);
    // give the exit handler a beat to clear the child
    await new Promise((resolve) => setTimeout(resolve, 200));
    // the next exec respawns the kernel; state is gone
    const fresh = await kernel.exec(
      'def _probe():\n    try:\n        return x\n    except NameError:\n        return "state lost"\n_probe()',
    );
    expect(fresh.error).toBeNull();
    expect(fresh.resultRepr).toContain('state lost');
    expect(restarts).toHaveLength(1);
    expect(restarts[0]).toContain('code=3');
  });

  it('stops restarting after the limit is reached', async () => {
    const { kernel } = makeKernel({ maxRestarts: 0 });
    await kernel.start();
    await expect(kernel.exec('import os\nos._exit(3)')).rejects.toThrow(/exited/);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect(kernel.exec('1+1')).rejects.toThrow(/restart limit/);
  });
});
