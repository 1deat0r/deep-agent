# Roadmap

Deliberately out of scope for the MVP; listed so the gaps are explicit.

## Reliability

- Kernel auto-restart on crash/exit, with namespace loss surfaced to the model.
- Per-cell interrupts (SIGALRM timeout exists; mid-cell cancel does not).
- Context-window guards beyond char thresholds (token-aware budgeting, per-message limits).
- Daemon mode: sessions that keep running after the client disconnects
  (currently the process must stay up, which it does — but there is no detach).

## Capability

- Python-backed skills (prime-agent's `SKILL.md` + importable package format).
- Provider library: Anthropic, local models via Ollama/LM Studio profiles,
  per-session model selection.
- Sandboxed execution profiles (container/e2b-style) for untrusted repos.
- Desktop shell (DSH-style Electron/tray app) wrapping the same host.
- Editing UX niceties in the web GUI: streaming markdown rendering, diff views,
  message editing/resend, session titles derived from first message.

## Hardening

- Auth for the HTTP/SSE API when bound beyond loopback.
- Rate/usage accounting surfaced per session.
- Retry policy with backoff on provider errors and mid-turn recovery.
- Heartbeat/scheduled re-entry (prime-agent's `rlm_heartbeat` equivalent).
