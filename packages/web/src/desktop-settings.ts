// The desktop app's preload bridge (packages/desktop/src/preload.ts) exposes
// `window.desktopSettings`; in a plain browser / CLI-served GUI it is absent
// and the Settings modal stays display-only. Everything here is typed against
// the IPC contract in packages/desktop/src/main.ts.

export type ProviderEnvOverride = 'DEEP_AGENT_API_KEY' | 'DEEP_AGENT_MODEL' | 'DEEP_AGENT_BASE_URL';

export interface DesktopSettingsState {
  providerId: 'openai-compatible' | 'mock';
  model: string;
  baseUrl: string | undefined;
  hasApiKey: boolean;
  envOverrides: ProviderEnvOverride[];
  isFirstRun: boolean;
  updateCheckAvailable: boolean;
}

export interface DesktopSettingsApplyInput {
  id?: 'openai-compatible' | 'mock';
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export type DesktopSettingsApplyResult =
  | { ok: true; changed: boolean }
  | { ok: false; cancelled?: boolean; field?: string; message?: string };

interface DesktopSettingsBridge {
  state: () => Promise<unknown>;
  apply: (settings: unknown) => Promise<unknown>;
  checkForUpdates: () => Promise<unknown>;
}

declare global {
  interface Window {
    desktopSettings?: DesktopSettingsBridge;
  }
}

export function desktopSettingsAvailable(): boolean {
  return typeof window !== 'undefined' && window.desktopSettings !== undefined;
}

export async function getDesktopSettingsState(): Promise<DesktopSettingsState | null> {
  if (!desktopSettingsAvailable()) return null;
  const raw = await window.desktopSettings!.state();
  return raw as DesktopSettingsState;
}

export async function applyDesktopSettings(
  input: DesktopSettingsApplyInput,
): Promise<DesktopSettingsApplyResult> {
  if (!desktopSettingsAvailable()) {
    return { ok: false, message: 'The desktop settings bridge is not available.' };
  }
  const raw = await window.desktopSettings!.apply(input);
  return raw as DesktopSettingsApplyResult;
}

/** Manual update check for the .deb build; no-op without the bridge. */
export async function checkForDesktopUpdates(): Promise<void> {
  if (!desktopSettingsAvailable()) return;
  await window.desktopSettings!.checkForUpdates();
}
