# @deep-agent/desktop

The deep-agent desktop shell: an Electron window + tray over the embedded host
(see `.scratch/desktop-shell/map.md` for the decision set).

## Develop

```sh
pnpm build                # build host + web + desktop (repo root)
pnpm --filter @deep-agent/desktop start   # needs a display
```

The main embeds `createHost()` in-process on `127.0.0.1` and loads the served
GUI. `DEEP_AGENT_PORT` / the config file pick the port.

## Package (.deb + AppImage)

```sh
pnpm build                              # ensure dist/ everywhere
pnpm --filter @deep-agent/desktop dist  # electron-builder --linux AppImage deb
```

Artifacts land in `packages/desktop/release/`. The GUI is bundled from
`packages/web/dist` via `extraResources`.

> Note (this machine): the DSH harness shadows `pnpm` with a wrapper that runs
> node through its Electron binary, which breaks electron-builder's shell shim
> (`command -v node` resolves to the harness binary). If the dist step prints
> `dsh-desktop` help instead of building, run electron-builder directly:
>
> ```sh
> cd packages/desktop
> PATH="/usr/bin:/bin:/usr/local/bin" node ./node_modules/electron-builder/cli.js --linux AppImage deb
> ```

## Auto-update (dormant)

`src/update-check.ts` activates only when `DEEP_AGENT_UPDATE_FEED` is set:
AppImages then update silently on quit; `.deb` installs stay manual and get a
download notice pointing at `DEEP_AGENT_DOWNLOADS_URL` (fallback: the feed
URL). There is no release host yet, so nothing is configured.
