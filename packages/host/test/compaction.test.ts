import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlmChunk } from '@deep-agent/provider';
import { MockLlmClient, textTurn, toolCallTurn } from '@deep-agent/provider';
import { estimateTokens } from '../src/tokens.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, DEFAULT_CONFIG } from '../src/config.js';
import { createHost } from '../src/index.js';
import type { Host } from '../src/index.js';

let dataDir: string;
let hosts: Host[] = [];
const rootScripts: LlmChunk[][] = [];
const childScripts: LlmChunk[][] = [];
const rootMock = MockLlmClient.shared(rootScripts);
const childMock = MockLlmClient.shared(childScripts);

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'deep-agent-compact-'));
});

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.manager.disposeAll()));
  rootScripts.length = 0;
  childScripts.length = 0;
  rootMock.calls.length = 0;
  childMock.calls.length = 0;
});

function makeHost(extra: Partial<ReturnType<typeof loadConfig>> = {}): Host {
  const config = loadConfig({
    ...DEFAULT_CONFIG,
    dataDir,
    provider: { id: 'mock' as const, model: 'mock-model' },
    ...extra,
  });
  const host = createHost(config, (_config, ctx) => (ctx.role === 'child' ? childMock : rootMock));
  hosts.push(host);
  return host;
}

async function fillOldExchanges(session: { append: (entry: unknown) => void }, count: number) {
  for (let i = 0; i < count; i++) {
    session.append({ kind: 'message', role: 'user', content: `old user ${i} ${'y'.repeat(150)}` });
    session.append({
      kind: 'message',
      role: 'assistant',
      content: `old assistant ${i} ${'z'.repeat(150)}`,
    });
  }
}

describe('compaction', () => {
  it('uses the real BPE tokenizer, not the chars/4 fallback', () => {
    // chars/4 would estimate 25 for 100 chars; BPE merges the run down to ~13.
    expect(estimateTokens('a'.repeat(100))).toBeLessThan(20);
    expect(estimateTokens('The quick brown fox jumps over the lazy dog.')).toBe(10);
  });

  it('does nothing under the threshold', async () => {
    const host = makeHost({ compactAtTokens: 250_000 });
    const session = await host.manager.createSession({ title: 'small' });
    rootScripts.push(textTurn('plain answer'));
    await session.runTurn({ content: 'hello' });
    expect(session.transcript.some((entry) => entry.kind === 'compaction')).toBe(false);
    // exactly one provider call, and it carried the user message
    expect(rootMock.calls).toHaveLength(1);
    expect(rootMock.calls[0]?.messages.some((m) => m.content === 'hello')).toBe(true);
  });

  it('summarizes the prefix and swaps it for a marker when over the threshold', async () => {
    const host = makeHost({ compactAtTokens: 200, compactKeepTokens: 50 });
    const session = await host.manager.createSession({ title: 'big' });
    await fillOldExchanges(session, 6);
    rootScripts.push(textTurn('COMPACTED SUMMARY TEXT'));
    rootScripts.push(textTurn('final answer after compaction'));

    const result = await session.runTurn({ content: 'new request' });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('final answer after compaction');

    const compaction = session.transcript.find(
      (entry): entry is Extract<(typeof session.transcript)[number], { kind: 'compaction' }> =>
        entry.kind === 'compaction',
    );
    expect(compaction?.summary).toBe('COMPACTED SUMMARY TEXT');

    // call 0 = summarization (2 messages, no tools), call 1 = the turn
    expect(rootMock.calls).toHaveLength(2);
    expect(rootMock.calls[0]?.messages).toHaveLength(2);
    expect(rootMock.calls[0]?.messages[0]?.role).toBe('system');
    expect(rootMock.calls[0]?.messages[1]?.content).toContain('old user 0');

    const turnMessages = rootMock.calls[1]?.messages ?? [];
    const text = JSON.stringify(turnMessages.map((m) => m.content));
    expect(text).toContain('COMPACTED SUMMARY TEXT');
    expect(text).toContain('new request');
    expect(text).not.toContain('old user 0');
  });

  it('rebuilds context from a prior marker (resume-safe)', async () => {
    const host = makeHost({ compactAtTokens: 200, compactKeepTokens: 50 });
    const session = await host.manager.createSession({ title: 'resume' });
    await fillOldExchanges(session, 5);
    session.append({
      kind: 'compaction',
      summary: 'PRIOR SUMMARY',
      // the next appended entry (the runTurn user message) is the cut point
      from: session.transcript.length,
      timestamp: new Date().toISOString(),
    });
    rootScripts.push(textTurn('answer after resume'));

    await session.runTurn({ content: 'continue' });

    // content after the marker is small, so no NEW summarization happened:
    // exactly one provider call this turn, carrying the marker summary.
    expect(rootMock.calls).toHaveLength(1);
    const text = JSON.stringify(rootMock.calls[0]?.messages.map((m) => m.content));
    expect(text).toContain('PRIOR SUMMARY');
    expect(text).toContain('continue');
    expect(text).not.toContain('old user 0');
  });

  it('compacts mid-turn when a tool result pushes the context over the threshold', async () => {
    const host = makeHost({ compactAtTokens: 100, compactKeepTokens: 40 });
    const session = await host.manager.createSession({ title: 'mid-turn' });
    rootScripts.push(
      toolCallTurn('ipython', { code: "print('PRINT_HHHH_CODE' + 'h' * 1200)" }),
      textTurn('MID-TURN SUMMARY'),
      textTurn('final after mid-turn compaction'),
    );

    const result = await session.runTurn({ content: 'produce a huge tool result' });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('final after mid-turn compaction');

    const compaction = session.transcript.find(
      (entry): entry is Extract<(typeof session.transcript)[number], { kind: 'compaction' }> =>
        entry.kind === 'compaction',
    );
    expect(compaction?.summary).toBe('MID-TURN SUMMARY');

    // call order: turn call 1, summarization, turn call 2
    expect(rootMock.calls).toHaveLength(3);
    expect(rootMock.calls[1]?.messages[0]?.content).toContain('compacting a conversation');
    const finalContext = JSON.stringify(rootMock.calls[2]?.messages.map((m) => m.content));
    // the old prefix (the user message) is summarized away, while the most
    // recent tool result stays paired with its call and visible to the model
    expect(finalContext).toContain('MID-TURN SUMMARY');
    expect(finalContext).not.toContain('produce a huge tool result');
    expect(finalContext).toContain('hhhhh');
  });

  it('proceeds uncompacted when summarization fails', async () => {
    const host = makeHost({ compactAtTokens: 200, compactKeepTokens: 50 });
    const session = await host.manager.createSession({ title: 'fail-safe' });
    await fillOldExchanges(session, 6);
    rootScripts.push([{ type: 'error', message: 'provider down' }]);
    rootScripts.push(textTurn('answered anyway'));

    const result = await session.runTurn({ content: 'request' });
    expect(result.ok).toBe(true);
    expect(session.transcript.some((entry) => entry.kind === 'compaction')).toBe(false);
    // the turn still ran with the full (uncompacted) context
    const text = JSON.stringify(rootMock.calls[1]?.messages.map((m) => m.content));
    expect(text).toContain('old user 0');
  });
});
