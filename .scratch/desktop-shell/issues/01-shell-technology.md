# 01 — Shell technology: Electron or Tauri?

Type: research
Status: resolved

## Question

Which shell technology should the deep-agent desktop app use — Electron or
Tauri? Judge for a Linux-first desktop wrapper around a localhost web GUI where
the backend is a TypeScript/Node host we already own. Considerations: in-process
embedding of the Node host (Electron main is Node; Tauri is Rust), tray/window
needs, bundle size, update story, toolchain availability on this machine, and
packaging effort for .deb/AppImage.

## Answer

**Electron.** Deciding facts: (1) Electron's main process is Node.js, so the
existing `createHost()`/`HostServer.start()` TypeScript host embeds in-process
with no boundary — Tauri's Rust core would force the Node host to run as a
supervised sidecar; (2) this machine already has Node v26.7.0 and needs nothing
more for Electron, whereas Tauri adds a Rust toolchain plus a missing
`libayatana-appindicator3` tray library; (3) Tauri's only win is bundle size
(~few MB vs ~100 MB+), which is a non-goal for a self-hosted local app.

Full findings + sources:
`.scratch/desktop-shell/research/01-shell-technology.md`.
