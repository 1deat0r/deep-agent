# 01 — Shell technology: Electron or Tauri?

Type: research
Status: claimed

## Question

Which shell technology should the deep-agent desktop app use — Electron or
Tauri? Judge for a Linux-first desktop wrapper around a localhost web GUI where
the backend is a TypeScript/Node host we already own. Considerations: in-process
embedding of the Node host (Electron main is Node; Tauri is Rust), tray/window
needs, bundle size, update story, toolchain availability on this machine, and
packaging effort for .deb/AppImage.
