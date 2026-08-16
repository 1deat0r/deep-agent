# 05 — Electron window security baseline

Type: task
Status: open

## Question

Which hardening settings does the Electron window use to load the local GUI?
Decide and record the baseline before any window ships: `contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`, no remote content (navigation
blocked, `setWindowOpenHandler` denies), CSP compatible with the Vite build,
and the renderer talks only to `http://127.0.0.1:<port>`. Verify the built GUI
works under those settings — the implementation session records the exact
`webPreferences` block as this ticket's answer.
