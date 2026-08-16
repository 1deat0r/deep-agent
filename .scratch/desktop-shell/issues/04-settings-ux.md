# 04 — Settings UX: where does the provider config get edited?

Type: grilling
Status: resolved

## Question

Today provider config (API key, model, base URL) is set in a config file at
server start; the GUI Settings modal is display-only. The desktop app needs a
real settings path. Decision needed: a host config-write endpoint the GUI uses
(with what validation/restart semantics), or keep file editing external and
make the desktop app open/point at it? Depends on the shell choice, since
Electron could also edit the file directly from the main process.

## Comments

- 2026-08-17 grilling round 1: Q1 settled — **GUI writes via Electron main
  (IPC)**. The renderer sends settings over a narrow preload bridge; the main
  process validates them (reusing the host's config loading) and rewrites the
  config file, then restarts/reloads the embedded host. No new HTTP write
  surface — a malicious webpage can't reach the config through the pinned
  window.
- 2026-08-17 grilling round 2: Q2 settled — **provider fields only** (id,
  model, apiKey, baseUrl; port/host stay config-file-only). Q3 settled — the
  **API key stays plaintext in the config file with 0600 permissions**, same
  as today; no keychain dependency. (Tray menu contents and close behavior
  were settled in the same round; recorded on the map.)

## Answer

Resolved 2026-08-17 across three grilling rounds; the user confirmed shared
understanding.

- **Mechanism**: the GUI writes settings through the Electron main process —
  the renderer sends the four provider fields over a narrow preload bridge
  (the only IPC surface, contextIsolation'd per ticket 05); the main
  validates, merges into the config file, and restarts the embedded host. No
  HTTP config-write endpoint: a localhost write surface reachable by other
  local processes / DNS-rebinding pages is not worth it.
- **Editable fields**: `provider.id`, `provider.model`, `provider.apiKey`,
  `provider.baseUrl` — nothing else. Port/host and the tuning knobs
  (`temperature`, `maxTokens`) stay config-file-only; the desktop app owns
  the port.
- **Key storage**: the API key stays plaintext in the config file, 0600
  permissions — same as today; no keychain dependency.
- **File location**: the desktop app reads and writes the CLI's config file,
  `~/.config/deep-agent/config.json` (honors `XDG_CONFIG_HOME`) — one config
  for CLI and desktop.
- **Restart semantics**: a validated save stops the embedded host (confirm
  dialog: active sessions end) and restarts it with the new config; the
  window reloads. The port is desktop-owned so the URL survives. First run:
  enter key → works immediately.
- **First run**: no config file or empty `apiKey` → the window opens into the
  Settings modal.
- **Implementation notes**: main writes atomically (tmp + rename) with 0600;
  validation reuses the host's `loadConfig` shape plus GUI field checks
  (non-empty key, URL-shaped baseUrl). Caveat: env overrides
  (`DEEP_AGENT_API_KEY` etc.) sit above the file, so the GUI should surface
  "overridden by environment" when a relevant env var is set instead of
  silently appearing to ignore edits.
