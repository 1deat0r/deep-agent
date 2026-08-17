import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlmChunk } from '@deep-agent/provider';
import { MockLlmClient } from '@deep-agent/provider';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig } from '../src/config.js';
import { createHost } from '../src/index.js';
import { SessionStore } from '../src/store.js';
import type { TranscriptEntry } from '../src/types.js';
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

function makeHost(): Host {
  const config = loadConfig({
    ...DEFAULT_CONFIG,
    dataDir,
    provider: { id: 'mock' as const, model: 'mock-model' },
  });
  const host = createHost(config, () => MockLlmClient.shared(scripts));
  hosts.push(host);
  return host;
}

const USAGE = {
  promptTokens: 100,
  completionTokens: 10,
  cacheHitTokens: 80,
  cacheMissTokens: 20,
};

describe('usage on transcript entries', () => {
  it('attaches provider usage to the assistant entry and the message_complete event', async () => {
    const host = makeHost();
    const session = await host.manager.createSession({ title: 't' });
    scripts.push([
      { type: 'delta', content: 'answer' },
      { type: 'done', finishReason: 'stop', usage: USAGE },
    ]);
    const completed: TranscriptEntry[] = [];
    host.events.on((event) => {
      if (event.type === 'message_complete') completed.push(event.message);
    });

    await session.runTurn({ content: 'hi' });

    const assistant = session.transcript.filter(
      (entry) => entry.kind === 'message' && entry.role === 'assistant',
    );
    expect(assistant).toHaveLength(1);
    const entry = assistant[0];
    expect(entry?.kind === 'message' ? entry.usage : undefined).toEqual(USAGE);
    expect(completed).toHaveLength(1);
    const eventMessage = completed[0];
    expect(eventMessage?.kind === 'message' ? eventMessage.usage : undefined).toEqual(USAGE);
  });

  it('strips usage from LLM-facing messages so it never round-trips', () => {
    const entries: TranscriptEntry[] = [
      { kind: 'message', role: 'user', content: 'hi' },
      { kind: 'message', role: 'assistant', content: null, usage: USAGE },
    ];
    const messages = SessionStore.messagesFrom(entries);
    expect(messages).toHaveLength(2);
    expect('usage' in messages[1]!).toBe(false);
    expect(messages[1]).toEqual({ role: 'assistant', content: null });
  });
});
