// deep-agent desktop shell — production main process.
// Embeds the host in-process (ticket 02), hardened window (ticket 05),
// close-to-tray + tray menu (map), and the settings write path (ticket 04):
// renderer → preload bridge → ipcMain → mergeProviderSettings → writeConfigFile
// → host restart. All policy lives in @deep-agent/host's config-write module;
// this file is the thin adapter.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron';
import {
  ConfigWriteError,
  createHost,
  defaultConfigPath,
  loadConfig,
  mergeProviderSettings,
  providerEnvOverrides,
  writeConfigFile,
} from '@deep-agent/host';
import type { Host } from '@deep-agent/host';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wireAutoUpdate } from './update-check.js';

// Wayland + Vulkan is incompatible in Electron 43's GPU path; the window is a
// text UI, so render through XWayland without GPU acceleration (ticket 05).
app.commandLine.appendSwitch('ozone-platform', 'x11');
app.disableHardwareAcceleration();

// Single instance: a second launch hands off and exits (ticket 02).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let host: Host | null = null;
  let tray: Tray | null = null;
  let window: BrowserWindow | null = null;
  let quitting = false;
  let baseUrl = '';

  // A tiny solid square so the tray has something to draw (16x16 PNG).
  const trayIcon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGNgGAWjYBSMglEwCkbBKBhVg6jRgAFiNCY0Gj2iDdGADxowTQFFREhKGTQ0Gj2iDdEAAGiyA/vvE5HmAAAAAElFTkSuQmCC',
  );

  /** The config file this app reads and writes: DEEP_AGENT_CONFIG or the XDG default. */
  function configPath(): string {
    return process.env.DEEP_AGENT_CONFIG ?? defaultConfigPath();
  }

  /** First run = no config file yet, or a keyless provider (boots as mock). */
  function isFirstRun(): boolean {
    return !existsSync(configPath()) || !host?.config.provider.apiKey;
  }

  /** Packaged apps bundle the GUI; in dev the host's repo-relative default applies. */
  function resolveWebDir(): string | undefined {
    if (process.env.DEEP_AGENT_WEB_DIR) return process.env.DEEP_AGENT_WEB_DIR;
    if (app.isPackaged) {
      const candidates = [
        join(process.resourcesPath, 'web'),
        join(process.resourcesPath, 'app.asar', 'web'),
      ];
      const found = candidates.find((dir) => existsSync(join(dir, 'index.html')));
      if (found) return found;
    }
    return undefined;
  }

  async function startHost(): Promise<{ port: number; host: string }> {
    const webDir = resolveWebDir();
    if (webDir) process.env.DEEP_AGENT_WEB_DIR = webDir;
    // Host pinned to 127.0.0.1 (ticket 05); port comes from the config file.
    const config = loadConfig({ host: '127.0.0.1' });
    host = createHost(config);
    const bound = await host.server.start();
    console.log(
      `[desktop] embedded host serving http://127.0.0.1:${bound.port} ` +
        `(provider ${config.provider.id}/${config.provider.model})`,
    );
    return bound;
  }

  async function shutdown(): Promise<void> {
    quitting = true;
    await host?.manager.disposeAll();
    await host?.server.stop();
    app.quit();
  }

  function createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      webPreferences: {
        // Ticket 05 baseline: the renderer has no Node, no shared context.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: join(dirname(fileURLToPath(import.meta.url)), 'preload.js'),
      },
    });
    // Ticket 05 baseline: no new windows, no permissions, no navigation off the host.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(baseUrl)) event.preventDefault();
    });
    // Close-to-tray: closing hides the window; the host keeps serving.
    win.on('close', (event) => {
      if (!quitting) {
        event.preventDefault();
        win.hide();
      }
    });
    return win;
  }

  app.whenReady().then(async () => {
    try {
      const bound = await startHost();
      baseUrl = `http://127.0.0.1:${bound.port}`;
      window = createWindow();
      await window.loadURL(`${baseUrl}/`);

      tray = new Tray(trayIcon);
      tray.setToolTip('deep-agent');
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: 'Open deep-agent',
            click: () => {
              window?.show();
              window?.focus();
            },
          },
          { type: 'separator' },
          { label: 'Quit', click: () => void shutdown() },
        ]),
      );
    } catch (error) {
      dialog.showErrorBox('deep-agent', `Failed to start: ${(error as Error).message}`);
      app.quit();
    }
  });

  app.on('second-instance', () => {
    window?.show();
    window?.focus();
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  // Dormant until a release host exists (ticket 03).
  wireAutoUpdate();

  // --- settings IPC (ticket 04): the narrow bridge the renderer may use -----

  ipcMain.handle('settings:state', () => ({
    providerId: host?.config.provider.id,
    model: host?.config.provider.model,
    baseUrl: host?.config.provider.baseUrl,
    hasApiKey: Boolean(host?.config.provider.apiKey),
    envOverrides: providerEnvOverrides(),
    isFirstRun: isFirstRun(),
  }));

  ipcMain.handle('settings:apply', async (event, rawSettings: unknown) => {
    if (!host) return { ok: false, message: 'host not running' };
    let merged;
    try {
      merged = mergeProviderSettings(host.config, rawSettings);
    } catch (error) {
      if (error instanceof ConfigWriteError) {
        return { ok: false, field: error.field, message: error.message };
      }
      throw error;
    }
    if (!merged.changed) return { ok: true, changed: false };

    const sessions = host.manager.list();
    if (sessions.length > 0) {
      const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const options = {
        type: 'warning' as const,
        buttons: ['Cancel', 'Save & restart'],
        defaultId: 0,
        cancelId: 0,
        title: 'Restart deep-agent',
        message: 'Saving settings restarts the host.',
        detail: `${sessions.length} session(s) will be stopped; their transcripts are kept.`,
      };
      const choice = owner ? dialog.showMessageBoxSync(owner, options) : dialog.showMessageBoxSync(options);
      if (choice !== 1) return { ok: false, cancelled: true };
    }

    writeConfigFile(configPath(), merged.config);
    await host.manager.disposeAll();
    await host.server.stop();
    const bound = await startHost();
    baseUrl = `http://127.0.0.1:${bound.port}`;
    await window?.loadURL(`${baseUrl}/`);
    return { ok: true, changed: true };
  });
}
