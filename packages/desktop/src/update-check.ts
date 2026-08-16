// Auto-update wiring (ticket 03): dormant until DEEP_AGENT_UPDATE_FEED is
// configured (there is no release host yet). When configured:
//   - AppImage: electron-updater checks automatically on startup and installs
//     silently on quit.
//   - deb: no automatic check — installs are manual, so the GUI offers a
//     "Check for updates" button (settings:state reports updateCheckAvailable)
//     and a notice points at the downloads page (DEEP_AGENT_DOWNLOADS_URL,
//     falling back to the feed URL).
import { app, dialog, shell } from 'electron';
// CJS module: default-import then destructure — the ESM loader cannot
// synthesize named exports from electron-updater inside an asar.
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

export interface UpdateState {
  /** Show the manual check affordance (enabled and not an AppImage). */
  manualCheck: boolean;
}

let enabled = false;
let downloadsUrl = '';

function isAppImage(): boolean {
  return Boolean(process.env.APPIMAGE);
}

function notifyAvailable(info: { version: string }): void {
  void dialog
    .showMessageBox({
      type: 'info',
      buttons: ['Later', 'Download'],
      defaultId: 1,
      title: 'Update available',
      message: `deep-agent ${info.version} is available.`,
      detail: 'The .deb package updates manually — download the new version and reinstall.',
    })
    .then(({ response }) => {
      if (response === 1 && /^https?:$/.test(new URL(downloadsUrl).protocol)) {
        void shell.openExternal(downloadsUrl);
      }
    });
}

export function wireAutoUpdate(): UpdateState {
  const feed = process.env.DEEP_AGENT_UPDATE_FEED;
  if (!feed) return { manualCheck: false }; // dormant: no remote, no releases.

  enabled = true;
  downloadsUrl = process.env.DEEP_AGENT_DOWNLOADS_URL ?? feed;
  autoUpdater.autoDownload = isAppImage();
  autoUpdater.autoInstallOnAppQuit = isAppImage();

  autoUpdater.setFeedURL({ provider: 'generic', url: feed });

  autoUpdater.on('update-available', (info) => {
    if (isAppImage()) {
      console.log(`[desktop] update available ${info.version}; installing on quit`);
      return;
    }
    notifyAvailable(info);
  });

  autoUpdater.on('error', (error) => {
    console.log(`[desktop] update check failed: ${error.message}`);
  });

  if (isAppImage()) {
    // AppImages auto-update: check once at startup (ticket 03).
    app.whenReady().then(() => {
      void autoUpdater.checkForUpdates().catch(() => undefined);
    });
  }

  return { manualCheck: !isAppImage() };
}

/** User-initiated check for the .deb build (no-op when the feed is dormant). */
export function checkForUpdatesNow(): void {
  if (!enabled) return;
  void autoUpdater.checkForUpdates().catch(() => undefined);
}
