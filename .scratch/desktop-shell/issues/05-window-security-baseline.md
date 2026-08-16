# 05 — Electron window security baseline

Type: task
Status: resolved

## Question

Which hardening settings does the Electron window use to load the local GUI?
Decide and record the baseline before any window ships: `contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`, no remote content (navigation
blocked, `setWindowOpenHandler` denies), CSP compatible with the Vite build,
and the renderer talks only to `http://127.0.0.1:<port>`. Verify the built GUI
works under those settings — the implementation session records the exact
`webPreferences` block as this ticket's answer.

## Answer

Baseline recorded 2026-08-17; the exact `webPreferences` block is the
prototype's, verified against the built GUI (headless, this machine):

```js
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
});
```

Window-level rules:

- `setWindowOpenHandler(() => ({ action: 'deny' }))` — no new windows.
- `will-navigate` — pinned to `http://127.0.0.1:<port>`; anything else is
  prevented.
- `setPermissionRequestHandler` — deny all permission requests.
- The renderer talks only to `http://127.0.0.1:<port>` (the same origin the
  GUI is served from); no remote content anywhere.

CSP: the built GUI has no inline scripts or styles (verified in
`packages/web/dist/index.html`), so the desktop host must serve this policy
with the GUI (response header or a meta tag injected at build):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none';
base-uri 'none'; frame-ancestors 'none'
```

Machine caveat: on Wayland this box needs the prototype's switches —
`ozone-platform=x11` and `app.disableHardwareAcceleration()` — because
Electron 43's GPU path is incompatible with Wayland+Vulkan here.

## Comments

- 2026-08-17 implemented (branch `desktop-shell`): the baseline ships in the
  production main (`packages/desktop/src/main.ts` — `webPreferences` block,
  window-open deny, navigation pin, session permission deny, Wayland switches);
  the CSP is served by the host on all GUI responses (`GUI_CSP` in
  `packages/host/src/server.ts`), covered by an HTTP test asserting the exact
  policy from this ticket. Verified headlessly under xvfb: the built GUI loads
  with the CSP header present.
