import { describe, expect, it } from 'vitest';
import { fromPartial } from '@total-typescript/shoehorn';
import type { TranscriptEntry } from '../src/types';
import { formatTokens, usageStats } from '../src/usage';

const U1 = { promptTokens: 100, completionTokens: 40, cacheHitTokens: 80, cacheMissTokens: 20 };
const U2 = { promptTokens: 30, completionTokens: 12 };

describe('usageStats', () => {
  it('sums session totals across assistant and compaction entries', () => {
    const entries = fromPartial<TranscriptEntry[]>([
      { kind: 'message', role: 'user', content: 'go' },
      { kind: 'message', role: 'assistant', content: null, usage: U1 },
      { kind: 'cell' },
      { kind: 'compaction', summary: 's', usage: { promptTokens: 10, completionTokens: 2 } },
      { kind: 'message', role: 'assistant', content: 'done', usage: U2 },
    ]);
    const stats = usageStats(entries);
    expect(stats.session.input).toBe(140);
    expect(stats.session.output).toBe(54);
    expect(stats.session.cacheHit).toBe(80);
    expect(stats.session.cacheMiss).toBe(20);
    expect(stats.session.cacheRate).toBeCloseTo(0.8);
  });

  it('scopes lastTurn to usage after the most recent user message', () => {
    const entries = fromPartial<TranscriptEntry[]>([
      { kind: 'message', role: 'user', content: 'first' },
      { kind: 'message', role: 'assistant', content: null, usage: U1 },
      { kind: 'message', role: 'user', content: 'second' },
      { kind: 'message', role: 'assistant', content: null, usage: U2 },
    ]);
    const stats = usageStats(entries);
    expect(stats.lastTurn.input).toBe(30);
    expect(stats.lastTurn.output).toBe(12);
    expect(stats.lastTurn.cacheHit).toBe(0);
    expect(stats.lastTurn.cacheMiss).toBe(0);
    expect(stats.lastTurn.cacheRate).toBeNull();
  });

  it('returns zeroed totals for an empty transcript', () => {
    const stats = usageStats([]);
    expect(stats).toEqual({
      session: { input: 0, output: 0, cacheHit: 0, cacheMiss: 0, cacheRate: null },
      lastTurn: { input: 0, output: 0, cacheHit: 0, cacheMiss: 0, cacheRate: null },
    });
  });
});

describe('formatTokens', () => {
  it('formats compact human-readable token counts', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(987)).toBe('987');
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(45_600)).toBe('45.6k');
    expect(formatTokens(1_234_000)).toBe('1.2M');
  });
});
