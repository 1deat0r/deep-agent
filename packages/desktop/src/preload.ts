// The renderer's only bridge to the main process (ticket 04): read settings
// state and apply edits. Nothing else crosses — the renderer stays sandboxed
// with contextIsolation (ticket 05).
import { contextBridge, ipcRenderer } from 'electron';

const desktopSettings = {
  state: (): Promise<unknown> => ipcRenderer.invoke('settings:state'),
  apply: (settings: unknown): Promise<unknown> => ipcRenderer.invoke('settings:apply', settings),
  checkForUpdates: (): Promise<unknown> => ipcRenderer.invoke('updates:check'),
};

contextBridge.exposeInMainWorld('desktopSettings', desktopSettings);
