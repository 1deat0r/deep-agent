# Composer chrome: model selector, reasoning selector, usage readout

Status: in-progress

The web GUI composer is bare (textarea + Continue/Send). Add the chrome users
expect from an agent chat UI:

- **Model selector** under the composer, fed by `GET /api/models`, per-session
  override (session meta.model already drives the per-turn client factory).
- **Reasoning selector** (auto/low/medium/high), per-session, passed through
  `LlmRequestOptions.reasoningEffort` -> `reasoning_effort` request body field
  when set. Providers that don't support it never receive the field (auto).
- **Usage readout**: last-turn and session-total input/output tokens plus cache
  hit-rate. Source of truth is the transcript: assistant and compaction entries
  carry optional `usage` (normalized cache hit/miss from OpenAI and DeepSeek
  wire shapes). `messagesFrom` must strip `usage` so it never round-trips into
  LLM context.

Non-goals: per-message model switching (per-session only), provider
capability probing, streaming usage mid-turn (usage arrives on the final
chunk).

Decisions:
- Reasoning effort is a session-meta field like model; both change via
  `POST /api/sessions/:id/settings` `{model?, reasoningEffort?}`.
- `reasoningEffort` absent on meta = unset; the request omits the field
  entirely so strict OpenAI-compatible servers never see an unknown param.
- Cache hit-rate = cacheHit / (cacheHit + cacheMiss) where both are known.
