import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlmChunk, LlmRequestOptions } from '@deep-agent/provider';
import { MockLlmClient, textTurn } from '@deep-agent/provider';
import { fromAny, fromPartial } from '@total-typescript/shoehorn';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig } from '../src/config.js';
import { createHost } from '../src/index.js';
import type { Host } from '../src/index.js';

let dataDir: string;
let hosts: Host[] = [];
const scripts: LlmChunk[][] = [];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'deep-agent-host-'));
});

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.manager.disposeAll()));
  scripts.length = 0;
});

/** Host whose client factory records the model and options each call receives. */
function makeHost(): { host: Host; models: string[]; options: LlmRequestOptions[] } {
  const models: string[] = [];
  const options: LlmRequestOptions[] = [];
  const config = loadConfig({
    ...DEFAULT_CONFIG,
    dataDir,
    port: 0,
    provider: { id: 'mock' as const, model: 'mock-model' },
  });
  const host = createHost(config, (_config, ctx) => {
    models.push(ctx.model);
    const inner = MockLlmClient.shared(scripts);
    return {
      id: 'mock',
      listModels: () => inner.listModels(),
      async *streamChat(messages, tools, opts) {
        if (opts !== undefined) options.push(opts);
        yield* inner.streamChat(messages, tools, opts);
      },
    };
  });
  hosts.push(host);
  return { host, models, options };
}

async function startServer(host: Host): Promise<number> {
  const { port } = await host.server.start();
  return port;
}

describe('session settings route', () => {
  it('sets model and reasoningEffort on the session and uses them on the next turn', async () => {
    const { host, models, options } = makeHost();
    const port = await startServer(host);
    const created = (await (
      await fetch(`http://127.0.0.1:${port}/api/sessions`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
    ).json()) as { meta: { id: string } };

    const response = await fetch(`http://127.0.0.1:${port}/api/sessions/${created.meta.id}/settings`, {
      method: 'POST',
      body: JSON.stringify({ model: 'deepseek-v4-flash', reasoningEffort: 'high' }),
    });
    expect(response.status).toBe(200);
    const body = fromPartial<{ meta: { model: string; reasoningEffort: string } }>(
      await response.json(),
    );
    expect(body.meta.model).toBe('deepseek-v4-flash');
    expect(body.meta.reasoningEffort).toBe('high');

    // The next turn uses the new model and passes the reasoning effort through.
    scripts.push(textTurn('ok'));
    const session = host.manager.get(created.meta.id);
    await session?.runTurn({ content: 'hi' });
    expect(models.at(-1)).toBe('deepseek-v4-flash');
    expect(options.at(-1)?.reasoningEffort).toBe('high');
  });

  it('clears reasoningEffort with "auto" and persists meta to disk', async () => {
    const { host } = makeHost();
    const port = await startServer(host);
    const created = (await (
      await fetch(`http://127.0.0.1:${port}/api/sessions`, { method: 'POST', body: '{}' })
    ).json()) as { meta: { id: string } };

    await fetch(`http://127.0.0.1:${port}/api/sessions/${created.meta.id}/settings`, {
      method: 'POST',
      body: JSON.stringify({ reasoningEffort: 'high' }),
    });
    const cleared = await fetch(`http://127.0.0.1:${port}/api/sessions/${created.meta.id}/settings`, {
      method: 'POST',
      body: JSON.stringify({ reasoningEffort: 'auto' }),
    });
    const body = fromPartial<{ meta: { reasoningEffort?: string } }>(await cleared.json());
    expect(body.meta.reasoningEffort).toBeUndefined();

    // meta.json on disk reflects the change (survives a host restart)
    const stored = JSON.parse(
      readFileSync(join(dataDir, 'sessions', created.meta.id, 'meta.json'), 'utf8'),
    ) as { reasoningEffort?: string };
    expect(stored.reasoningEffort).toBeUndefined();
  });

  it('rejects invalid settings', async () => {
    const { host } = makeHost();
    const port = await startServer(host);
    const created = (await (
      await fetch(`http://127.0.0.1:${port}/api/sessions`, { method: 'POST', body: '{}' })
    ).json()) as { meta: { id: string } };

    const badEffort = await fetch(
      `http://127.0.0.1:${port}/api/sessions/${created.meta.id}/settings`,
      { method: 'POST', body: JSON.stringify({ reasoningEffort: 'extreme' }) },
    );
    expect(badEffort.status).toBe(400);

    const emptyModel = await fetch(
      `http://127.0.0.1:${port}/api/sessions/${created.meta.id}/settings`,
      { method: 'POST', body: JSON.stringify({ model: '   ' }) },
    );
    expect(emptyModel.status).toBe(400);
  });
});
