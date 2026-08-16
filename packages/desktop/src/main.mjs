// PROTOTYPE — throwaway. Answers wayfinder ticket 02: can the deep-agent host
// embed in-process inside an Electron main? Also previews ticket 05's security
// baseline. Do not build production on this file.
import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import { createHost, loadConfig } from '@deep-agent/host';

const PORT = Number(process.env.DEEP_AGENT_PORT ?? 3824);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Wayland + Vulkan is incompatible in Electron 43's GPU path; the window is a
// text UI, so render through XWayland without GPU acceleration.
app.commandLine.appendSwitch('ozone-platform', 'x11');
app.disableHardwareAcceleration();

// Single instance: a second launch hands off and exits.
if (!app.requestSingleInstanceLock()) {
  console.log('[desktop-prototype] another instance is running; exiting');
  app.quit();
} else {
  let host = null;
  let tray = null;
  let window = null;

  // A tiny solid square so the tray has something to draw (16x16 PNG).
  const trayIcon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGNgGAWjYBSMglEwCkbBKBhVg6jRgAFiNCY0Gj2iDdGADxowTQFFREhKGTQ0Gj2iDdEAAGiyA/vvE5HmAAAAAElFTkSuQmCC',
  );

  app.whenReady().then(async () => {
    // Embed the host in-process: exactly what the CLI does, no child process.
    const config = loadConfig({ port: PORT, host: '127.0.0.1' });
    host = createHost(config);
    const { port } = await host.server.start();
    console.log(`[desktop-prototype] embedded host serving http://127.0.0.1:${port}`);
    console.log(`[desktop-prototype] provider: ${config.provider.id} (${config.provider.model})`);

    // Ticket 05 baseline preview: hardened window, no remote content.
    window = new BrowserWindow({
      width: 1280,
      height: 860,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(BASE_URL)) event.preventDefault();
    });
    await window.loadURL(`${BASE_URL}/`);

    tray = new Tray(trayIcon);
    tray.setToolTip('deep-agent (prototype)');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open deep-agent', click: () => window?.show() },
        { type: 'separator' },
        { label: 'Quit', click: () => void shutdown() },
      ]),
    );
  });

  const shutdown = async () => {
    console.log('[desktop-prototype] shutting down embedded host');
    await host?.manager.disposeAll();
    await host?.server.stop();
    app.quit();
  };

  app.on('window-all-closed', () => void shutdown());
  app.on('second-instance', () => window?.show());
}
