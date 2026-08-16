import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { HostConfig } from './types.js';

export const DEFAULT_CONFIG: HostConfig = {
  port: 3824,
  host: '127.0.0.1',
  dataDir: join(homedir(), '.local', 'share', 'deep-agent'),
  maxDepth: 3,
  maxToolIterations: 60,
  maxAutoRounds: 10,
  execTimeoutMs: 0,
  maxKernelRestarts: 3,
  compactAtChars: 24000,
  compactKeepChars: 8000,
  provider: {
    id: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    temperature: 0.3,
  },
};

function deepMerge<T>(base: T, override: unknown): T {
  if (typeof override !== 'object' || override === null || Array.isArray(override)) {
    return base;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = (base as Record<string, unknown>)[key];
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof baseValue === 'object' &&
      baseValue !== null
    ) {
      out[key] = deepMerge(baseValue, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

export interface ConfigOverrides {
  port?: number;
  host?: string;
  dataDir?: string;
  pythonDir?: string;
  pythonPath?: string;
  maxDepth?: number;
  maxToolIterations?: number;
  maxAutoRounds?: number;
  execTimeoutMs?: number;
  maxKernelRestarts?: number;
  compactAtChars?: number;
  compactKeepChars?: number;
  provider?: Partial<HostConfig['provider']> & { id?: HostConfig['provider']['id'] };
}

/**
 * Build the host config from defaults, an optional JSON file, env vars, and
 * explicit overrides (later sources win).
 *
 * Env vars: DEEP_AGENT_CONFIG (file path), DEEP_AGENT_PORT, DEEP_AGENT_HOST,
 * DEEP_AGENT_DATA_DIR, DEEP_AGENT_PYTHON, DEEP_AGENT_PYTHON_DIR,
 * DEEP_AGENT_MODEL, DEEP_AGENT_BASE_URL, DEEP_AGENT_API_KEY.
 */
export function loadConfig(overrides: ConfigOverrides = {}): HostConfig {
  let config = structuredClone(DEFAULT_CONFIG);

  // Precedence (later wins): defaults → config file → env vars → overrides.
  // The config file is DEEP_AGENT_CONFIG, falling back to the per-user
  // default at ~/.config/deep-agent/config.json when it exists.
  const envFile = process.env.DEEP_AGENT_CONFIG ?? defaultConfigPath();
  if (envFile && existsSync(envFile)) {
    try {
      const fileConfig = JSON.parse(readFileSync(envFile, 'utf8')) as Partial<HostConfig>;
      config = deepMerge(config, fileConfig);
    } catch (error) {
      throw new Error(`failed to parse config file ${envFile}: ${(error as Error).message}`);
    }
  }

  const env: Record<string, unknown> = {
    ...(process.env.DEEP_AGENT_PORT ? { port: Number(process.env.DEEP_AGENT_PORT) } : {}),
    ...(process.env.DEEP_AGENT_HOST ? { host: process.env.DEEP_AGENT_HOST } : {}),
    ...(process.env.DEEP_AGENT_DATA_DIR ? { dataDir: process.env.DEEP_AGENT_DATA_DIR } : {}),
    ...(process.env.DEEP_AGENT_PYTHON ? { pythonPath: process.env.DEEP_AGENT_PYTHON } : {}),
    ...(process.env.DEEP_AGENT_PYTHON_DIR ? { pythonDir: process.env.DEEP_AGENT_PYTHON_DIR } : {}),
    ...(process.env.DEEP_AGENT_SKILLS_DIR ? { skillsDir: process.env.DEEP_AGENT_SKILLS_DIR } : {}),
    ...(process.env.DEEP_AGENT_MAX_DEPTH ? { maxDepth: Number(process.env.DEEP_AGENT_MAX_DEPTH) } : {}),
    ...(process.env.DEEP_AGENT_EXEC_TIMEOUT_MS
      ? { execTimeoutMs: Number(process.env.DEEP_AGENT_EXEC_TIMEOUT_MS) }
      : {}),
    ...(process.env.DEEP_AGENT_MODEL
      ? { provider: { model: process.env.DEEP_AGENT_MODEL } }
      : {}),
    ...(process.env.DEEP_AGENT_BASE_URL
      ? { provider: { baseUrl: process.env.DEEP_AGENT_BASE_URL } }
      : {}),
    ...(process.env.DEEP_AGENT_API_KEY
      ? { provider: { apiKey: process.env.DEEP_AGENT_API_KEY } }
      : {}),
  };
  config = deepMerge(config, env);
  config = deepMerge(config, overrides as unknown as Record<string, unknown>);

  mkdirSync(config.dataDir, { recursive: true });
  return config;
}

export function sessionsRoot(config: HostConfig): string {
  return resolve(join(config.dataDir, 'sessions'));
}

/** Per-user config file location: ~/.config/deep-agent/config.json. */
export function defaultConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(xdg, 'deep-agent', 'config.json');
}
