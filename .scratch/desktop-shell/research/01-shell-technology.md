# 01 — Shell technology: Electron or Tauri? (findings)

Type: research
Status: resolved
Researched: 2026-08-16 (UTC)

## Recommendation

**Electron.**

The desktop app is a thin window around an HTTP+SSE server we already own in
TypeScript/Node. Electron's main process *is* a Node.js environment, so the
existing `HostServer` class embeds in-process with no runtime boundary and no
second language. Tauri (v2) is a Rust core that would force the Node host to run
as a supervised sidecar — a meaningful amount of new machinery for no functional
gain, in exchange only for a smaller bundle.

## Deciding facts (the short version)

1. **In-process host embedding.** Electron's main process runs in a Node.js
   environment ([Electron process model][e-proc]). The repo already exposes
   `createHost(config)` → `host.server.start()` as plain TypeScript
   (`packages/host/src/index.ts`, `packages/host/src/server.ts`; the CLI calls
   exactly this in `packages/cli/src/bin/deep-agent.ts`). Electron main can do
   the same two lines in-process — no IPC serialization, no child-process
   supervision, no port/health handshake. Tauri's core is Rust; its documented
   path for a Node backend is a **sidecar** external binary with stdin/stdout
   plumbing ([Tauri sidecar][t-sidecar], [Node.js as a sidecar][t-node-sidecar]) —
   i.e. a Rust wrapper process managing a spawned Node host.

2. **Toolchain/runtime fit on this machine.** Node v26.7.0 is present and is the
   repo's runtime (pnpm + TS). Electron needs nothing more. Tauri adds a Rust
   toolchain (present: rustc/cargo 1.97.1) *plus* Linux system libraries —
   `webkit2gtk-4.1` **is** installed, but the tray-required
   `libayatana-appindicator3` **is not** ([Tauri prerequisites][t-prereq]) — and
   introduces a second language (Rust) into the repo for what is otherwise a
   thin window.

3. **Bundle size is Tauri's only real win, and it doesn't pay for itself here.**
   Electron ships Chromium + Node inside every app (≈100 MB+ installers); Tauri
   uses the OS webview and produces a small (≈few MB) Rust binary
   ([Tauri architecture][t-arch]). For a self-hosted *local* tool — not a
   mass-download consumer app — the extra ~100 MB is a one-time cost that does
   not outweigh the in-process host advantage above.

## Machine toolchain facts (verified 2026-08-16)

| Check | Result |
| --- | --- |
| `rustc --version` | rustc 1.97.1 (8bab26f4f 2026-07-14) |
| `cargo --version` | cargo 1.97.1 (c980f4866 2026-06-30) |
| `node --version` | v26.7.0 |
| `pnpm --version` | 11.7.0 |
| `npm --version` | 12.0.2 |
| OS | CachyOS (Arch-based, rolling), `x86_64` |
| Disk | 1.4 TiB free on `/dev/sda2` |
| `webkit2gtk-4.1` | present (2.52.5-2) — Tauri Linux webview runtime ✅ |
| `libayatana-appindicator3` | **MISSING** — required by Tauri for tray icons ⚠️ |
| `gtk3` | present ✅ |
| npm registry reachable | `pnpm view electron version` → 43.4.0 ✅ |
| npm registry reachable | `pnpm view @tauri-apps/cli version` → 2.11.4 ✅ |

Both toolchains can be made to work on this machine: Electron with the tools
already present, Tauri after additionally installing the missing
`libayatana-appindicator3` (and pulling in Rust-specific build deps). Electron's
npm postinstall downloads a prebuilt Chromium/Node binary; the registry is
reachable here, so `pnpm view`/`pnpm add electron` (not performed — see note)
should fetch the prebuilt binary normally.

## Analysis by decision factor

### 1. In-process host embedding (decisive)

- **Electron:** main process = Node.js ([Electron process model][e-proc]). The
  existing `createHost()` + `HostServer.start()` API
  (`packages/host/src/index.ts`, `packages/host/src/server.ts:74-103`) is called
  by the CLI with no process boundary (`packages/cli/src/bin/deep-agent.ts:140-142`).
  An Electron main can construct and start the host in-process and point a
  `BrowserWindow` at `http://127.0.0.1:3824`; lifecycle is `host.manager.disposeAll()`
  + `host.server.stop()` on quit.
- **Tauri:** Rust core, no Node runtime. The Node host must run as a
  **sidecar** — an external binary bundled via `externalBin` and driven over
  stdin/stdout ([Tauri sidecar][t-sidecar], [Node.js as a sidecar][t-node-sidecar]).
  That means: package the CLI/host as a standalone executable (or a bundled
  Node runtime), supervise its lifecycle from Rust, and coordinate
  start/health/port before the webview loads. More moving parts, two runtimes to
  package, and a Rust↔Node boundary for a wrapper whose whole job is "show the
  existing GUI."

### 2. Tray + single-instance

- **Electron:** both in core — `app.requestSingleInstanceLock()`
  ([Electron `app`][e-app]) and `Tray` ([Electron `Tray`][e-tray]). No plugin.
- **Tauri:** tray icon is in the v2 core (`tauri::tray::TrayIconBuilder`,
  [system tray guide][t-tray]); single-instance is a plugin
  ([single-instance plugin][t-single]). Functional parity, but Tauri's Linux
  tray additionally depends on `libayatana-appindicator3`, which is not
  installed here ([Tauri prerequisites][t-prereq]).

### 3. Bundle size

- **Electron:** bundles Chromium + Node into every app; installers are
  typically ~100 MB+ regardless of app code.
- **Tauri:** uses the OS webview (WebKitGTK on Linux) and a small Rust core, so
  binaries are ~a few MB ([Tauri architecture][t-arch]).
- Weight: real but not decisive for a self-hosted local tool.

### 4. Update story

- **Electron:** `autoUpdater` in core ([Electron `autoUpdater`][e-updater],
  [Updating applications][e-updates]); `electron-updater`/`electron-builder`
  support AppImage auto-update on Linux, while `.deb` updates flow through the
  system package manager ([electron-builder auto-update][eb-update]).
- **Tauri:** `tauri-plugin-updater` ([Tauri updater plugin][t-updater]) provides
  in-app updates. Both have a viable AppImage story; Electron's is the more
  mature/battle-tested path. Rough parity with a slight Electron edge.

### 5. Packaging for .deb/AppImage

- **Electron:** `electron-builder` produces `.deb` and `AppImage` (and rpm,
  tar.gz) as first-class Linux targets ([electron-builder Linux][eb-linux]).
  Mature and widely used.
- **Tauri:** the Tauri bundler also produces `.deb` and `AppImage` natively
  ([Tauri bundler][t-bundle]); artifacts are smaller. Rough parity; both are
  low-effort on Linux.

### 6. Toolchain availability (this machine)

Verified above. Electron runs on what's already here; Tauri would additionally
need `libayatana-appindicator3` (for tray) and brings Rust into the repo. Both
paths compile, but Electron has strictly fewer system dependencies and no
second language.

## Net

| Factor | Electron | Tauri | Winner |
| --- | --- | --- | --- |
| In-process Node host | ✅ main = Node | ❌ Rust + Node sidecar | Electron |
| Tray + single-instance | ✅ core | ✅ core + plugin (needs ayatana) | Electron (no missing lib) |
| Bundle size | ❌ ~100 MB+ | ✅ ~few MB | Tauri |
| Update story | ✅ mature (AppImage) | ✅ plugin | Electron (slight) |
| Toolchain on this machine | ✅ Node only | ⚠️ Rust + missing ayatana lib | Electron |
| .deb/AppImage packaging | ✅ electron-builder | ✅ bundler | Tie |

**Recommendation: Electron.** The host embeds in-process with the code we
already ship; the toolchain is already present; and the only Tauri advantage —
bundle size — is a non-goal for a self-hosted local desktop app. If bundle size
or a Rust-native core ever becomes a hard requirement, Tauri remains a viable
migration, but it would pay a sidecar tax today for no functional benefit.

---

## Sources

Electron:
- [Electron process model — main process runs in a Node.js environment][e-proc]
- [Electron `app` API — `requestSingleInstanceLock()`][e-app]
- [Electron `Tray` API][e-tray]
- [Electron `autoUpdater` API][e-updater]
- [Electron "Updating applications" guide][e-updates]
- [electron-builder — Auto Update (AppImage / Linux)][eb-update]
- [electron-builder — Linux targets (.deb, AppImage)][eb-linux]
- [npm: `electron`][npm-electron] (version at research time: 43.4.0)

Tauri:
- [Tauri v2 architecture][t-arch]
- [Tauri v2 process model][t-proc]
- [Tauri v2 prerequisites (Linux system libraries)][t-prereq]
- [Tauri v2 sidecar — embedding external binaries][t-sidecar]
- [Tauri v2 — Node.js as a sidecar][t-node-sidecar]
- [Tauri v2 single-instance plugin][t-single]
- [Tauri v2 updater plugin][t-updater]
- [Tauri v2 system tray][t-tray]
- [Tauri bundler / distribute][t-bundle]
- [npm: `@tauri-apps/cli`][npm-tauri] (version at research time: 2.11.4)

Repo (local evidence):
- `packages/host/src/server.ts` — `HostServer` class with `start()`/`stop()`.
- `packages/host/src/index.ts` — `createHost()` factory (no process boundary).
- `packages/host/src/config.ts` — default `host: '127.0.0.1'`, `port: 3824`.
- `packages/cli/src/bin/deep-agent.ts` — CLI calls `createHost()` +
  `host.server.start()`; confirms the host is embeddable in-process.

[e-proc]: https://www.electronjs.org/docs/latest/tutorial/process-model
[e-app]: https://www.electronjs.org/docs/latest/api/app
[e-tray]: https://www.electronjs.org/docs/latest/api/tray
[e-updater]: https://www.electronjs.org/docs/latest/api/auto-updater
[e-updates]: https://www.electronjs.org/docs/latest/tutorial/updates
[eb-update]: https://www.electron.build/auto-update
[eb-linux]: https://www.electron.build/linux
[npm-electron]: https://www.npmjs.com/package/electron
[t-arch]: https://v2.tauri.app/concept/architecture/
[t-proc]: https://v2.tauri.app/concept/process-model/
[t-prereq]: https://v2.tauri.app/start/prerequisites/
[t-sidecar]: https://v2.tauri.app/develop/sidecar/
[t-node-sidecar]: https://v2.tauri.app/learn/sidecar-nodejs/
[t-single]: https://v2.tauri.app/plugin/single-instance/
[t-updater]: https://v2.tauri.app/plugin/updater/
[t-tray]: https://v2.tauri.app/learn/system-tray/
[t-bundle]: https://v2.tauri.app/distribute/
[npm-tauri]: https://www.npmjs.com/package/@tauri-apps/cli
