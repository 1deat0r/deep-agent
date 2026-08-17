import type { TranscriptEntry, UsageInfo } from './types';

export interface UsageTotals {
  input: number;
  output: number;
  cacheHit: number;
  cacheMiss: number;
  /** cacheHit / (cacheHit + cacheMiss) in 0..1, or null when the provider reported no cache split. */
  cacheRate: number | null;
}

export interface UsageStats {
  /** Cumulative totals across the whole transcript (model spend only). */
  session: UsageTotals;
  /** Totals for entries after the most recent user message (the turn just run). */
  lastTurn: UsageTotals;
}

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheHit: 0, cacheMiss: 0, cacheRate: null };
}

function usageOf(entry: TranscriptEntry): UsageInfo | undefined {
  if (entry.kind === 'message') return entry.usage;
  if (entry.kind === 'compaction') return entry.usage;
  return undefined;
}

function add(totals: UsageTotals, usage: UsageInfo): void {
  totals.input += usage.promptTokens ?? 0;
  totals.output += usage.completionTokens ?? 0;
  totals.cacheHit += usage.cacheHitTokens ?? 0;
  totals.cacheMiss += usage.cacheMissTokens ?? 0;
}

function finish(totals: UsageTotals): UsageTotals {
  const denominator = totals.cacheHit + totals.cacheMiss;
  totals.cacheRate = denominator > 0 ? totals.cacheHit / denominator : null;
  return totals;
}

/** Token/cache statistics over a transcript, split into session and last-turn scopes. */
export function usageStats(entries: TranscriptEntry[]): UsageStats {
  let start = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.kind === 'message' && entry.role === 'user') {
      start = i + 1;
      break;
    }
  }
  const session = emptyTotals();
  const lastTurn = emptyTotals();
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry === undefined) continue;
    const usage = usageOf(entry);
    if (usage === undefined) continue;
    add(session, usage);
    if (i >= start) add(lastTurn, usage);
  }
  return { session: finish(session), lastTurn: finish(lastTurn) };
}

/** Compact human-readable token count: 987, 1.2k, 45.6k, 1.2M. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}
