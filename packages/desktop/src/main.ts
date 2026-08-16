// deep-agent desktop shell — production main process.
// Embeds the host in-process (ticket 02), hardened window (ticket 05),
// close-to-tray + tray menu (map), and the settings write path (ticket 04):
// renderer → preload bridge → ipcMain → mergeProviderSettings → writeConfigFile
// → host restart. All policy lives in @deep-agent/host's config-write module;
// this file is the thin adapter.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron';
import {
  ConfigWriteError,
  configFileBase,
  createHost,
  defaultConfigPath,
  loadConfig,
  mergeProviderSettings,
  providerEnvOverrides,
  writeConfigFile,
} from '@deep-agent/host';
import type { Host, HostConfig } from '@deep-agent/host';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkForUpdatesNow, wireAutoUpdate } from './update-check.js';

// Wayland + Vulkan is incompatible in Electron 43's GPU path; the window is a
// text UI, so render through XWayland without GPU acceleration (ticket 05).
// The env hint is set too: Chromium prefers it over the switch when both
// DISPLAY and WAYLAND_DISPLAY exist, and we must never land on Wayland.
process.env.ELECTRON_OZONE_PLATFORM_HINT = 'x11';
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
  /** The desktop owns the port for the app's lifetime (ticket 04). */
  let ownedPort: number | undefined;

  // A tiny solid square so the tray has something to draw (16x16 PNG).
  const trayIcon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGNgGAWjYBSMglEwCkbBKBhVg6jRgAFiNCY0Gj2iDdGADxowTQFFREhKGTQ0Gj2iDdEAAGiyA/vvE5HmAAAAAElFTkSuQmCC',
  );

  /** The config file this app reads and writes: DEEP_AGENT_CONFIG or the XDG default. */
  function configPath(): string {
    return process.env.DEEP_AGENT_CONFIG ?? defaultConfigPath();
  }

  function provider(): HostConfig['provider'] | undefined {
    return host?.config.provider;
  }

  /** Ticket 05: navigation is pinned to the host's origin, not a string prefix. */
  function sameOrigin(url: string): boolean {
    try {
      return new URL(url).origin === new URL(baseUrl).origin;
    } catch {
      return false;
    }
  }

  /** Settings needed on first run: no config file, or a keyed provider without a key. */
  function needsProviderSetup(): boolean {
    if (!existsSync(configPath())) return true;
    const p = provider();
    return p?.id === 'openai-compatible' && !p.apiKey;
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
    // Host pinned to 127.0.0.1 (ticket 05); the desktop owns the port for its
    // lifetime so a settings-triggered restart never moves the URL (ticket 04).
    const config = loadConfig({
      host: '127.0.0.1',
      ...(ownedPort !== undefined ? { port: ownedPort } : {}),
    });
    host = createHost(config);
    const bound = await host.server.start();
    ownedPort = bound.port;
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
      if (!sameOrigin(url)) event.preventDefault();
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
  const updateState = wireAutoUpdate();

  // --- settings IPC (ticket 04): the narrow bridge the renderer may use -----

  ipcMain.handle('settings:state', () => {
    const p = provider();
    return {
      providerId: p?.id,
      model: p?.model,
      baseUrl: p?.baseUrl,
      hasApiKey: Boolean(p?.apiKey),
      envOverrides: providerEnvOverrides(),
      isFirstRun: needsProviderSetup(),
      updateCheckAvailable: updateState.manualCheck,
    };
  });

  ipcMain.handle('settings:apply', async (event, rawSettings: unknown) => {
    if (!host) return { ok: false, message: 'host not running' };
    let merged;
    try {
      // Merge into what the FILE yields (no env): env overrides sit above the
      // file and must never be baked into it (ticket 04).
      merged = mergeProviderSettings(configFileBase(configPath()), rawSettings);
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

  // Manual update check for the .deb build (ticket 03); the AppImage path
  // checks automatically on startup instead.
  ipcMain.handle('updates:check', () => {
    checkForUpdatesNow();
    return { ok: true };
  });
}
