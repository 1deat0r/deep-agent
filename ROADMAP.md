# Roadmap

Deliberately out of scope so far; listed so the gaps are explicit.

## Capability

- Provider library: Anthropic and local models via Ollama/LM Studio profiles.
- Sandboxed execution profiles (container/e2b-style) for untrusted repos.
- Desktop shell (DSH-style Electron/tray app) wrapping the same host.
- Editing UX niceties in the web GUI: streaming markdown rendering, diff views,
  message editing/resend, session titles derived from first message.

## Hardening

- Auth for the HTTP/SSE API when bound beyond loopback.
- Rate/usage accounting surfaced per session.
- Retry policy with backoff on provider errors and mid-turn recovery.
- Heartbeat/scheduled re-entry (prime-agent's `rlm_heartbeat` equivalent).
