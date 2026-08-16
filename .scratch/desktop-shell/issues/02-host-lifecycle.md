# 02 — Host lifecycle: embed in-process or spawn the CLI?

Type: prototype
Status: claimed
Blocked by: 01

## Question

Should the desktop app embed the deep-agent host in-process (create HostServer
directly in the Electron main, per the CLI's own thinness) or spawn
`deep-agent serve --daemon` as a child? Build a rough artifact to react to: a
minimal main process that starts the host embedded and loads the built GUI, with
single-instance lock and a tray quit. Does this shape feel right?

## Prototype artifact (awaiting your reaction)

Built on throwaway branch `prototype/desktop-embed`: `packages/desktop/` — an
Electron main (~90 lines) that embeds `createHost()` in-process, loads the built
GUI, locks single-instance, and shows a tray menu (Open/Quit). Verified
headlessly: embedded host serves `/api/health`, the GUI, and `/api/models`;
second launch exits. Security baseline (ticket 05) previewed: contextIsolation,
no nodeIntegration, sandbox, navigation pinned to 127.0.0.1.

Run it yourself: `cd packages/desktop && pnpm start` (needs your display).
