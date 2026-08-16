import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlmChunk } from '@deep-agent/provider';
import { MockLlmClient, textTurn, toolCallTurn } from '@deep-agent/provider';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, DEFAULT_CONFIG } from '../src/config.js';
import { EventBus } from '../src/events.js';
import { createHost } from '../src/index.js';
import { AgentManager } from '../src/manager.js';
import { SessionStore } from '../src/store.js';
import type { Host } from '../src/index.js';

let dataDir: string;
let hosts: Host[] = [];
const rootScripts: LlmChunk[][] = [];
const childScripts: LlmChunk[][] = [];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'deep-agent-host-'));
});

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.manager.disposeAll()));
  rootScripts.length = 0;
  childScripts.length = 0;
});

function makeHost(extra: Partial<ReturnType<typeof loadConfig>> = {}): Host {
  const config = loadConfig({
    ...DEFAULT_CONFIG,
    dataDir,
    provider: { id: 'mock' as const, model: 'mock-model' },
    maxAutoRounds: 2,
    ...extra,
  });
  const host = createHost(config, (_config, ctx) =>
    MockLlmClient.shared(ctx.role === 'child' ? childScripts : rootScripts),
  );
  hosts.push(host);
  return host;
}

function waitFor(predicate: () => boolean, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('waitFor timed out'));
      }
    }, 50);
  });
}

describe('RLM agent loop', () => {
  it('executes ipython tool calls through the persistent kernel and answers', async () => {
    const host = makeHost();
    const session = await host.manager.createSession({ title: 't1' });
    rootScripts.push(
      toolCallTurn(
        'ipython',
        { code: "from pathlib import Path\nPath('answer.txt').write_text('42')\nprint('wrote it')\n'ok'" },
      ),
      textTurn('The file is written. Done.'),
    );
    const events: string[] = [];
    host.events.on((event) => events.push(event.type));

    const result = await session.runTurn({ content: 'write answer.txt with 42' });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('The file is written. Done.');
    expect(readFileSync(join(session.workspaceDir, 'answer.txt'), 'utf8')).toBe('42');

    // transcript contains the tool call, tool result, cell, and final answer
    const kinds = session.transcript.map((entry) => entry.kind);
    expect(kinds).toEqual(['message', 'message', 'cell', 'message', 'message']);
    const cell = session.transcript.find((entry) => entry.kind === 'cell');
    expect(cell && cell.kind === 'cell' ? cell.stdout : '').toContain('wrote it');
    expect(events).toContain('turn_start');
    expect(events).toContain('turn_end');
    expect(events).toContain('cell_result');
    expect(events).toContain('message_delta');
  });

  it('persists state across turns and survives reload', async () => {
    const host = makeHost();
    const session = await host.manager.createSession({ title: 't1' });
    // prime the counter first
    await session.execConsole('counter = 10');
    rootScripts.push(
      toolCallTurn('ipython', { code: 'counter += 1\ncounter' }, 'c1'),
      textTurn('incremented'),
    );
    await session.runTurn({ content: 'increment' });

    rootScripts.push(
      toolCallTurn('ipython', { code: 'counter += 1\ncounter' }, 'c2'),
      textTurn('done'),
    );
    await session.runTurn({ content: 'increment again' });
    const cells = session.transcript.filter((entry) => entry.kind === 'cell');
    expect(cells[1] && cells[1].kind === 'cell' ? cells[1].resultRepr : null).toBe('12');

    // reload from disk with a fresh manager
    const config = loadConfig({
      ...DEFAULT_CONFIG,
      dataDir,
      provider: { id: 'mock' as const, model: 'mock-model' },
    });
    const freshHost = createHost(config, () => MockLlmClient.shared(rootScripts));
    hosts.push(freshHost);
    const restored = freshHost.manager.get(session.id);
    expect(restored).toBeDefined();
    expect(restored?.transcript.length).toBe(session.transcript.length);
  });
});

describe('rlm children', () => {
  it('spawns a child via rlm(), runs it, and routes its result back to the parent', async () => {
    const host = makeHost();
    const parent = await host.manager.createSession({ title: 'root-session' });
    rootScripts.push(
      toolCallTurn(
        'ipython',
        { code: 'handle = await rlm("compute the answer", name="worker")\nhandle' },
        'call-spawn',
      ),
      textTurn('spawned the worker; ending my turn.'),
      textTurn('woke up after the child reply and confirmed the answer'),
    );
    childScripts.push(textTurn('child computed: answer is 42'));
    const childEvents: string[] = [];
    host.events.on((event) => {
      if (event.type === 'child_spawned' || event.type === 'child_finished') {
        childEvents.push(event.type);
      }
    });

    const result = await parent.runTurn({ content: 'spawn a worker to compute the answer' });
    expect(result.ok).toBe(true);
    expect(parent.meta.childIds).toHaveLength(1);
    const childId = parent.meta.childIds[0] ?? '';
    expect(childId).not.toBe('');

    await waitFor(() => host.manager.get(childId)?.status === 'idle');
    const child = host.manager.get(childId);
    expect(child?.meta.role).toBe('child');
    expect(child?.meta.parentId).toBe(parent.id);
    expect(child?.meta.parentTitle).toBe('root-session');

    await waitFor(() =>
      parent.transcript.some(
        (entry) =>
          entry.kind === 'message' &&
          entry.role === 'user' &&
          entry.name === 'worker',
      ),
    );
    expect(childEvents).toEqual(['child_spawned', 'child_finished']);
    // the child reply wakes the parent even without an active goal
    await waitFor(() => parent.meta.lastSummary?.includes('woke up') === true);
  });

  it('enforces max depth', async () => {
    const host = makeHost({ maxDepth: 1 });
    const parent = await host.manager.createSession({ title: 'root' });
    // root (depth 0) may spawn a child (depth 1)...
    const { child_id } = await host.manager.spawnChild(parent, 'first level', 'l1');
    const child = host.manager.get(child_id);
    expect(child?.meta.depth).toBe(1);
    // ...but that child cannot spawn further.
    await expect(host.manager.spawnChild(child!, 'grandchild', 'nested')).rejects.toThrow(
      /depth/,
    );
  });

  it('deleting a child removes it from disk (no resurrection on reload)', async () => {
    const host = makeHost();
    const parent = await host.manager.createSession({ title: 'root' });
    const { child_id } = await host.manager.spawnChild(parent, 'do work', 'worker');
    await waitFor(() => host.manager.get(child_id)?.status === 'idle');
    expect(host.manager.get(child_id)).toBeDefined();

    await host.manager.deleteChild(parent, 'worker');
    expect(host.manager.get(child_id)).toBeUndefined();
    expect(parent.meta.childIds).not.toContain(child_id);
    expect(existsSync(join(host.config.dataDir, 'sessions', child_id))).toBe(false);

    // a restarted host must not resurrect the deleted child
    const config = loadConfig({
      ...DEFAULT_CONFIG,
      dataDir,
      provider: { id: 'mock' as const, model: 'mock-model' },
    });
    const freshHost = createHost(config, () => MockLlmClient.shared(rootScripts));
    hosts.push(freshHost);
    expect(freshHost.manager.list().some((meta) => meta.id === child_id)).toBe(false);
  });

  it('deleting a session cascades to children and emits session_deleted', async () => {
    const host = makeHost();
    const parent = await host.manager.createSession({ title: 'root' });
    const { child_id } = await host.manager.spawnChild(parent, 'do work', 'worker');
    await waitFor(() => host.manager.get(child_id)?.status === 'idle');
    const deletedEvents: string[] = [];
    host.events.on((event) => {
      if (event.type === 'session_deleted') deletedEvents.push(event.sessionId);
    });

    expect(await host.manager.deleteSession(parent.id)).toBe(true);
    expect(host.manager.get(parent.id)).toBeUndefined();
    expect(host.manager.get(child_id)).toBeUndefined();
    expect(existsSync(join(host.config.dataDir, 'sessions', child_id))).toBe(false);
    expect(existsSync(join(host.config.dataDir, 'sessions', parent.id))).toBe(false);
    expect(deletedEvents).toContain(parent.id);
    expect(deletedEvents).toContain(child_id);

    // idempotent false for a missing session
    expect(await host.manager.deleteSession(parent.id)).toBe(false);
  });
});

describe('kernel restart', () => {
  it('restarts a crashed kernel mid-turn, tells the model state was lost, and continues', async () => {
    const host = makeHost();
    const session = await host.manager.createSession({ title: 'crashy' });
    rootScripts.push(
      toolCallTurn('ipython', { code: 'import os\nos._exit(7)' }, 'call-crash'),
      toolCallTurn('ipython', { code: '21 * 2' }, 'call-after'),
      textTurn('recovered and finished'),
    );
    const restarts: string[] = [];
    host.events.on((event) => {
      if (event.type === 'kernel_restarted') restarts.push(event.reason);
    });

    const result = await session.runTurn({ content: 'crash the kernel, then keep going' });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('recovered and finished');
    expect(restarts).toHaveLength(1);
    expect(restarts[0]).toContain('code=7');
    const notice = session.transcript.find(
      (entry) =>
        entry.kind === 'message' &&
        entry.role === 'system' &&
        (entry.content ?? '').includes('kernel crashed'),
    );
    expect(notice).toBeDefined();
  });
});

describe('goals and autonomous continuation', () => {
  it('auto-continues until the round limit, then blocks the goal', async () => {
    const host = makeHost({ maxAutoRounds: 2 });
    const session = await host.manager.createSession({ title: 'goal-session', goal: 'ship it' });
    expect(session.meta.goal?.status).toBe('active');
    expect(session.meta.autoContinue).toBe(true);
    rootScripts.push(
      textTurn('round one work done'),
      textTurn('round two work done'),
      textTurn('round three work done'),
    );
    await session.runTurn({ content: 'start working' });
    await waitFor(() => session.meta.goal?.status === 'blocked', 20000);
    expect(session.meta.goal?.rounds).toBe(2);
    expect(session.meta.goal?.blockedReason).toContain('round limit');
  });

  it('a user message supersedes a pending goal continuation', async () => {
    const host = makeHost({ maxAutoRounds: 5 });
    const session = await host.manager.createSession({ title: 'goal-session', goal: 'ship it' });
    rootScripts.push(textTurn('first turn done'));
    await session.runTurn({ content: 'start' });
    // The 250ms continuation timer is pending; a user message must pause the loop.
    rootScripts.push(textTurn('user-directed answer'));
    await session.runTurn({ content: 'do this specific thing instead' });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(session.meta.goal?.rounds).toBe(0);
    expect(session.meta.autoContinue).toBe(false);
    const systemMessages = session.transcript.filter(
      (entry) => entry.kind === 'message' && entry.name === 'system',
    );
    expect(systemMessages).toHaveLength(0);
  });

  it('goal create/complete via kernel host requests', async () => {
    const host = makeHost();
    const session = await host.manager.createSession({ title: 'g' });
    const result = await session.execConsole('await rlm.goal.create("implement the parser")');
    expect(result.error).toBeNull();
    expect(session.meta.goal?.objective).toBe('implement the parser');
    await session.execConsole('await rlm.goal.complete("parser shipped")');
    expect(session.meta.goal?.status).toBe('completed');
    expect(session.meta.goal?.summary).toBe('parser shipped');
  });
});

describe('skills', () => {
  it('seeds the bundled suite and the kernel reaches it through host requests', async () => {
    const host = makeHost();
    // bundled skills from the repo are seeded into the temp data dir
    expect(host.skills.list().some((skill) => skill.name === 'tdd')).toBe(true);

    const session = await host.manager.createSession({ title: 'skills-session' });
    const listResult = await session.execConsole(
      "[s['name'] for s in await rlm.skills.list()]",
    );
    expect(listResult.error).toBeNull();
    expect(listResult.resultRepr).toContain('tdd');
    expect(listResult.resultRepr).toContain('research');

    const loadResult = await session.execConsole('await rlm.skills.load("tdd")');
    expect(loadResult.error).toBeNull();
    expect(loadResult.resultRepr).toContain('content');

    const unknown = await session.execConsole('await rlm.skills.load("no-such-skill")');
    expect(unknown.error?.type).toBe('HostError');
  });

  it('installs a workspace skill from inside the kernel', async () => {
    const host = makeHost();
    const session = await host.manager.createSession({ title: 'installer' });
    const result = await session.execConsole(
      'from pathlib import Path\n' +
        'Path("newskill/SKILL.md").parent.mkdir(parents=True, exist_ok=True)\n' +
        'Path("newskill/SKILL.md").write_text("---\\nname: newskill\\ndescription: Brand new\\n---\\n\\n# New\\n")\n' +
        'await rlm.skills.install("newskill")',
    );
    expect(result.error).toBeNull();
    expect(host.skills.has('newskill')).toBe(true);
    expect(host.skills.load('newskill').content).toContain('# New');
  });
});

describe('HTTP server', () => {
  it('serves the REST API end to end with the mock provider', async () => {
    const host = makeHost();
    host.config.port = 0;
    const { port } = await host.server.start();
    try {
      const base = `http://127.0.0.1:${port}`;
      const health = await fetch(`${base}/api/health`).then((r) => r.json());
      expect(health.ok).toBe(true);

      const created = (await fetch(`${base}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'http-session' }),
      }).then((r) => r.json())) as { meta: { id: string } };
      const sessionId = created.meta.id;

      rootScripts.push(textTurn('http answer'));
      const accepted = await fetch(`${base}/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'hello over http' }),
      });
      expect(accepted.status).toBe(202);

      const session = host.manager.get(sessionId);
      expect(session).toBeDefined();
      await waitFor(() => session?.status === 'idle');
      const detail = (await fetch(`${base}/api/sessions/${sessionId}`).then((r) =>
        r.json(),
      )) as { meta: { status: string }; transcript: { kind: string }[] };
      expect(detail.meta.status).toBe('idle');
      expect(detail.transcript.some((entry) => entry.kind === 'message')).toBe(true);

      const list = (await fetch(`${base}/api/sessions`).then((r) =>
        r.json(),
      )) as { sessions: { id: string }[] };
      expect(list.sessions.some((meta) => meta.id === sessionId)).toBe(true);

      const cell = await fetch(`${base}/api/sessions/${sessionId}/kernel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: '21 * 2' }),
      }).then((r) => r.json());
      expect((cell as { resultRepr: string }).resultRepr).toBe('42');

      const skills = (await fetch(`${base}/api/skills`).then((r) =>
        r.json(),
      )) as { dir: string; skills: { name: string }[] };
      expect(skills.skills.some((skill) => skill.name === 'tdd')).toBe(true);
    } finally {
      await host.server.stop();
    }
  });
});
