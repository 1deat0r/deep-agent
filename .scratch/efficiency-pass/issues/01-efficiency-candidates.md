# 01: Efficiency / token-efficiency pass candidates

Status: unclaimed

Directive: optimize for max speed, efficiency, token-efficiency, quality,
accuracy. Candidates noticed while wiring the composer chrome:

- `tokens.ts` re-estimates message tokens every `ensureCompacted`/turn; per-turn
  re-encoding could be cached per message (memoize by content hash or attach
  estimate at append time).
- `ensureCompacted` and `buildTurnMessages` may both tokenize the same window
  each turn (check for double work).
- `/api/models` is fetched on every config load; could cache with a TTL or
  refresh on demand.
- Provider `listModels` sorts and returns everything; the composer only needs
  the list (fine) but errors fall back to a single default silently.

Benchmark before/after any change; no speculative optimizations without
measurement.
