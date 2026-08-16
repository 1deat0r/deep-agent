// Auto-update wiring (ticket 03): dormant until DEEP_AGENT_UPDATE_FEED is
// configured (there is no release host yet). When configured:
//   - AppImage: electron-updater downloads silently and installs on quit.
//   - deb: installs are manual — a notice points at the downloads page
//     (DEEP_AGENT_DOWNLOADS_URL, falling back to the feed URL).
import { app, dialog, shell } from 'electron';
// CJS module: default-import then destructure — the ESM loader cannot
// synthesize named exports from electron-updater inside an asar.
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

export function wireAutoUpdate(): void {
  const feed = process.env.DEEP_AGENT_UPDATE_FEED;
  if (!feed) return; // dormant: no remote, no releases, nothing to check.

  const downloads = process.env.DEEP_AGENT_DOWNLOADS_URL ?? feed;
  const isAppImage = Boolean(process.env.APPIMAGE);
  autoUpdater.autoDownload = isAppImage;
  autoUpdater.autoInstallOnAppQuit = isAppImage;

  autoUpdater.setFeedURL({ provider: 'generic', url: feed });

  autoUpdater.on('update-available', (info) => {
    if (isAppImage) {
      console.log(`[desktop] update available ${info.version}; installing on quit`);
      return;
    }
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
        if (response === 1 && /^https?:$/.test(new URL(downloads).protocol)) {
          void shell.openExternal(downloads);
        }
      });
  });

  autoUpdater.on('error', (error) => {
    console.log(`[desktop] update check failed: ${error.message}`);
  });

  app.whenReady().then(() => {
    void autoUpdater.checkForUpdates().catch(() => undefined);
  });
}
