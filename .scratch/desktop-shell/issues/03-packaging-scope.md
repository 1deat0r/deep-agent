# 03 — Packaging scope and targets

Type: grilling
Status: resolved

## Question

What does "ship it" mean for the desktop app? Which OS targets first (Linux
.deb/AppImage given this machine, macOS, Windows), what update expectations,
and is signing required anywhere? A live conversation — the answers fix the
packaging scope everything downstream inherits.

## Answer

Resolved 2026-08-17 across three grilling rounds; the user confirmed shared
understanding of the full tree.

- **Targets**: Linux only for the first release; macOS and Windows join later
  once the Linux path is proven.
- **Formats**: `.deb` + `AppImage`, x86_64 (amd64) only for v1.
- **Signing**: unsigned — Linux has no universal signing authority; signing /
  notarization decisions arrive together with the macOS/Windows targets.
- **Updates**: the AppImage auto-updates via `electron-updater` (AppImageUpdater)
  wired to a configurable feed URL — inert until the repo gains a remote; the
  `.deb` build gets a manual "check for updates" entry pointing at the
  downloads page, absent until then.
- **Builds**: a local `pnpm` build script on this machine produces both
  artifacts (electron-builder; dpkg-deb is present, AppImage tooling
  self-fetches); GitHub Actions joins the day the repo gains a remote.
- **Identity**: productName and deb package `deep-agent`, appId
  `io.deepagent.desktop`, maintainer `deep-agent maintainers`.

## Comments

- 2026-08-17 research refinement (after the answer settled): electron-builder
  bundles its own fpm + AppImage tooling, so local `.deb`/AppImage builds need
  nothing beyond the pnpm script; electron-updater ≥7 also supports
  deb/rpm/pacman (pkexec/sudo elevation) — a future option that could lift the
  `.deb` to auto-update without an apt repo; macOS targets must be built on
  macOS (signing/notarization can't be fixed elsewhere), Windows NSIS can build
  on Linux via wine. Signing ballpark: Apple Developer Program $99/yr; Windows
  OV $200–500/yr, EV $300–700+/yr, or Azure Trusted Signing ~$9.99/mo. CI sketch
  for when a remote exists: one `ubuntu-latest` tag-triggered job running
  `electron-builder --linux AppImage deb --publish always` with a `GH_TOKEN`.
- 2026-08-17 full research sheet, build-script details: electron-builder's
  Linux defaults are AppImage + Snap, so the build script must pass
  `--linux AppImage deb` explicitly; on this Arch box AppImage icon handling
  needs `openjpeg2` (libopenjp2-tools); the packaged app must run `pnpm build`
  (host + web) before electron-builder so the built GUI is embedded in the
  artifacts; `releaseType: draft` if releases should be promoted manually.
  Nothing in the sheet changes the settled decisions.
- 2026-08-17 implemented (branch `desktop-shell`): `packages/desktop` gained
  `electron-builder.yml` (appId `io.deepagent.desktop`, productName
  `deep-agent`, maintainer `deep-agent maintainers`, targets AppImage + deb,
  GUI bundled via `extraResources` → `resources/web`; no publish provider) and
  the `dist` script (`electron-builder --linux AppImage deb`). The
  auto-updater is wired in `src/update-check.ts` but dormant: it activates
  only when `DEEP_AGENT_UPDATE_FEED` is set — AppImage then updates silently
  on quit, the `.deb` shows a download notice pointing at
  `DEEP_AGENT_DOWNLOADS_URL`.
- 2026-08-17 verified: `release/deep-agent-0.1.0.AppImage` and
  `release/deep-agent_0.1.0_amd64.deb` build on this machine (electron-builder
  bundled its own fpm/AppImage tooling, as researched); deb metadata checks
  out (package `deep-agent`, amd64, maintainer, homepage) and bundles the GUI
  at `/opt/deep-agent/resources/web/`; the packaged AppImage was run headlessly
  under xvfb — embedded host serves `/api/health` and the bundled GUI. Notes:
  `executableName`/deb `artifactName` had to be pinned because the scoped
  package name produces invalid artifact paths; `homepage` is the RFC-2606
  placeholder `https://deep-agent.invalid` until a remote exists; icon is the
  default Electron one (branding later). One packaging bug was fixed along the
  way: `electron-updater` is CJS, so the ESM main must default-import it
  (named imports fail inside the asar).
