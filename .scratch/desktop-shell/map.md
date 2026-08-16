# Desktop Shell

## Destination

The desktop-shell decision set: every open decision resolved so an implementation
session can build a native desktop app for deep-agent (window + tray, server
lifecycle, settings UX, packaging) without further discovery.

**Reached 2026-08-17** — all five tickets resolved; an implementation session
can start from this map.

## Notes

- Domain: consult `AGENTS.md`, `packages/host/CONTEXT.md`, `packages/cli/CONTEXT.md`,
  and `docs/architecture.md`. The host already serves the web GUI; `HostServer`
  is a class that can run in-process; the CLI is a thin wrapper.
- Standing facts: the host binds 127.0.0.1 by default; `deep-agent serve --daemon`
  and a systemd user unit already exist; the GUI is a static Vite build served
  by the host.
- Tracker: local markdown (`.scratch/`), conventions in `docs/agents/issue-tracker.md`.

## Decisions so far

- **01 — Shell technology: Electron.** The desktop app is a thin window over the
  existing TypeScript/Node `HostServer`; Electron's main process (Node.js) embeds
  that host in-process with no sidecar/Rust boundary, and the machine already has
  Node v26.7.0 (Tauri would add Rust + a missing `libayatana-appindicator3` for
  the tray). Tauri's bundle-size win is a non-goal for a self-hosted local tool.
  → `research/01-shell-technology.md`.
- **02 — Host lifecycle: embed in-process.** The Electron main creates and owns
  `HostServer` directly (same shape as the CLI), verified by the headless
  prototype: embedded host serves the GUI + API, single-instance lock, tray
  Open/Quit. Resolved on the user's verdict. → `issues/02-host-lifecycle.md`.
- **03 — Packaging scope: Linux-first.** `.deb` + `AppImage` (amd64), unsigned;
  the AppImage auto-updates via `electron-updater` on a configurable feed URL
  (inert until a remote exists), the `.deb` updates manually; local build script
  now, GitHub Actions when a remote exists; productName/deb package
  `deep-agent`, appId `io.deepagent.desktop`, maintainer `deep-agent
  maintainers`. → `issues/03-packaging-scope.md`.
- **04 — Settings UX: GUI writes via the Electron main.** The GUI edits the four
  provider fields (id, model, apiKey, baseUrl) through a narrow preload bridge;
  the main validates, rewrites the shared config file
  (`~/.config/deep-agent/config.json`, 0600, key in plaintext), and restarts
  the embedded host (confirm dialog). First run with no key auto-opens
  Settings. No HTTP config-write endpoint. → `issues/04-settings-ux.md`.
- **05 — Window security baseline.** `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`; window-open denied, navigation
  pinned to `http://127.0.0.1:<port>`, permission requests denied; strict CSP
  served with the GUI (built GUI has no inline scripts); Wayland machines use
  `ozone-platform=x11` + hardware acceleration off. → `issues/05-window-security-baseline.md`.
- **Window & tray behavior (settled with 04).** Tray menu is Open deep-agent /
  Quit; closing the window hides to tray — the embedded host keeps serving and
  sessions survive; Quit is via the tray.

## Out of scope

- Remote/phone access and API auth — a separate effort (the destination here is
  the local desktop app).
- Rebuilding the GUI — the existing web GUI is the app's window, not a native UI.
