# 02 — Host lifecycle: embed in-process or spawn the CLI?

Type: prototype
Status: resolved
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

## Answer

**Embed in-process.** The Electron main creates and owns `HostServer`
directly — the same shape as the CLI. One process, one lifecycle, no child to
babysit; the prototype verified headlessly that the embedded host serves the
GUI and API, the single-instance lock hands off a second launch, and the tray
gives Open/Quit.

Resolved 2026-08-17 on the user's verdict. The `prototype/desktop-embed`
branch stays throwaway; production packaging scope is ticket 03.

## Comments

- 2026-08-17 implemented (branch `desktop-shell`): the production main
  (`packages/desktop/src/main.ts`) embeds the host in-process exactly per this
  ticket — `loadConfig({ host: '127.0.0.1' })` → `createHost` → `server.start`
  → window loads the served GUI. Single-instance lock, tray Open/Quit, and
  close-to-tray are wired; the settings path restarts the embedded host
  in-place (dispose sessions → stop server → start again) instead of a child
  process. Verified headlessly under xvfb (embedded host serves the GUI + API,
  CSP header present).
