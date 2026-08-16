# Desktop Shell

## Destination

The desktop-shell decision set: every open decision resolved so an implementation
session can build a native desktop app for deep-agent (window + tray, server
lifecycle, settings UX, packaging) without further discovery.

## Notes

- Domain: consult `AGENTS.md`, `packages/host/CONTEXT.md`, `packages/cli/CONTEXT.md`,
  and `docs/architecture.md`. The host already serves the web GUI; `HostServer`
  is a class that can run in-process; the CLI is a thin wrapper.
- Standing facts: the host binds 127.0.0.1 by default; `deep-agent serve --daemon`
  and a systemd user unit already exist; the GUI is a static Vite build served
  by the host.
- Tracker: local markdown (`.scratch/`), conventions in `docs/agents/issue-tracker.md`.

## Decisions so far

<!-- filled as tickets resolve -->

## Not yet specified

- Auto-update mechanism for the packaged app (waits on the packaging-scope decision).
- Signing/notarization story (waits on packaging scope).
- CI pipeline for building the installers (waits on packaging scope).
- Tray menu contents beyond start/stop/open (waits on the embed prototype).

## Out of scope

- Remote/phone access and API auth — a separate effort (the destination here is
  the local desktop app).
- Rebuilding the GUI — the existing web GUI is the app's window, not a native UI.
