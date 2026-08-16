import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_CONFIG } from './config.js';
import type { HostConfig } from './types.js';

const PROVIDER_IDS = ['openai-compatible', 'mock'] as const;

export type ProviderField = 'id' | 'model' | 'apiKey' | 'baseUrl';

/** Typed validation failure; `field` points at the offending setting for GUI highlighting. */
export class ConfigWriteError extends Error {
  readonly field: ProviderField | undefined;

  constructor(message: string, field?: ProviderField) {
    super(message);
    this.name = 'ConfigWriteError';
    this.field = field;
  }
}

export interface ProviderSettingsMerge {
  config: HostConfig;
  changed: boolean;
}

/**
 * Merge GUI provider settings into a config without touching anything else.
 *
 * The input is `unknown` because it crosses the preload bridge from the
 * renderer; runtime shape validation is part of this seam. `undefined` leaves
 * a field untouched, `''` clears it. Unknown input fields are ignored. The
 * input config is never mutated; on validation failure it is untouched.
 */
export function mergeProviderSettings(config: HostConfig, input: unknown): ProviderSettingsMerge {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ConfigWriteError('settings must be an object');
  }
  const raw = input as Record<string, unknown>;

  const id = raw.id;
  if (id !== undefined && !(PROVIDER_IDS as readonly unknown[]).includes(id)) {
    throw new ConfigWriteError(`unknown provider id: ${String(id)}`, 'id');
  }
  const model = raw.model;
  if (model !== undefined && (typeof model !== 'string' || model.trim() === '')) {
    throw new ConfigWriteError('model must be a non-empty string', 'model');
  }
  const apiKey = raw.apiKey;
  if (apiKey !== undefined && typeof apiKey !== 'string') {
    throw new ConfigWriteError('apiKey must be a string', 'apiKey');
  }
  const baseUrl = raw.baseUrl;
  if (baseUrl !== undefined && typeof baseUrl !== 'string') {
    throw new ConfigWriteError('baseUrl must be a string', 'baseUrl');
  }
  if (typeof baseUrl === 'string' && baseUrl !== '') {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new ConfigWriteError(`invalid baseUrl: ${baseUrl}`, 'baseUrl');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ConfigWriteError('baseUrl must be http(s)', 'baseUrl');
    }
  }

  const next = structuredClone(config);
  const provider = next.provider;
  if (id !== undefined) provider.id = id as 'openai-compatible' | 'mock';
  if (model !== undefined) provider.model = model;
  if (apiKey !== undefined) {
    if (apiKey === '') delete provider.apiKey;
    else provider.apiKey = apiKey;
  }
  if (baseUrl !== undefined) {
    if (baseUrl === '') delete provider.baseUrl;
    else provider.baseUrl = baseUrl;
  }

  if (provider.id === 'openai-compatible' && !provider.apiKey) {
    throw new ConfigWriteError('apiKey is required for the openai-compatible provider', 'apiKey');
  }

  const changed = JSON.stringify(provider) !== JSON.stringify(config.provider);
  return { config: next, changed };
}

/**
 * Atomically write a config file: serialize, write a temp file in the same
 * directory with mode 0600, then rename over the target. On any failure the
 * existing file is untouched and the temp file is cleaned up. Missing parent
 * directories are created.
 */
export function writeConfigFile(path: string, config: HostConfig): void {
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, serialized, { mode: 0o600 });
  try {
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort cleanup; the original error is what matters
    }
    throw error;
  }
}

export type ProviderEnvOverride = 'DEEP_AGENT_API_KEY' | 'DEEP_AGENT_MODEL' | 'DEEP_AGENT_BASE_URL';

/**
 * The config a write should start from: what the file yields merged over the
 * defaults, with **no environment variables** — env overrides sit above the
 * file and must never be baked into it. A missing or malformed file yields
 * the defaults. Unknown keys are preserved so a save never clobbers them.
 */
export function configFileBase(path: string): HostConfig {
  let fileConfig: Record<string, unknown> = {};
  try {
    fileConfig = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    // Missing or malformed: start from defaults.
  }
  const rawProvider =
    typeof fileConfig.provider === 'object' && fileConfig.provider !== null
      ? (fileConfig.provider as Record<string, unknown>)
      : {};
  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    provider: { ...DEFAULT_CONFIG.provider, ...rawProvider },
  } as HostConfig;
}

/**
 * Which provider env overrides shadow the config file, feeding the GUI's
 * "overridden by environment" notice (ticket 04). Empty strings don't count.
 */
export function providerEnvOverrides(
  env: Record<string, string | undefined> = process.env,
): ProviderEnvOverride[] {
  const overrides: ProviderEnvOverride[] = [];
  if (env.DEEP_AGENT_API_KEY) overrides.push('DEEP_AGENT_API_KEY');
  if (env.DEEP_AGENT_MODEL) overrides.push('DEEP_AGENT_MODEL');
  if (env.DEEP_AGENT_BASE_URL) overrides.push('DEEP_AGENT_BASE_URL');
  return overrides;
}
