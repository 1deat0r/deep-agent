import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultConfigPath, loadConfig } from '../src/config.js';

const ENV_KEYS = [
  'XDG_CONFIG_HOME',
  'DEEP_AGENT_CONFIG',
  'DEEP_AGENT_PORT',
  'DEEP_AGENT_HOST',
  'DEEP_AGENT_DATA_DIR',
  'DEEP_AGENT_PYTHON',
  'DEEP_AGENT_PYTHON_DIR',
  'DEEP_AGENT_SKILLS_DIR',
  'DEEP_AGENT_MAX_DEPTH',
  'DEEP_AGENT_EXEC_TIMEOUT_MS',
  'DEEP_AGENT_MODEL',
  'DEEP_AGENT_BASE_URL',
  'DEEP_AGENT_API_KEY',
];

let savedEnv: Record<string, string | undefined>;
let root: string;
let dataDir: string;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  root = mkdtempSync(join(tmpdir(), 'deep-agent-config-'));
  dataDir = join(root, 'data');
  process.env.DEEP_AGENT_DATA_DIR = dataDir;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe('config', () => {
  it('defaultConfigPath() returns ~/.config/deep-agent/config.json and respects XDG_CONFIG_HOME', () => {
    delete process.env.XDG_CONFIG_HOME;
    expect(defaultConfigPath()).toBe(join(process.env.HOME ?? '', '.config', 'deep-agent', 'config.json'));

    const xdg = join(root, 'xdg');
    process.env.XDG_CONFIG_HOME = xdg;
    expect(defaultConfigPath()).toBe(join(xdg, 'deep-agent', 'config.json'));
  });

  it('loadConfig merges the default config file when DEEP_AGENT_CONFIG is unset', () => {
    const xdg = join(root, 'xdg');
    process.env.XDG_CONFIG_HOME = xdg;
    const configDir = join(xdg, 'deep-agent');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ port: 9999, host: '0.0.0.0', maxDepth: 7 }),
    );

    const config = loadConfig();
    expect(config.port).toBe(9999);
    expect(config.host).toBe('0.0.0.0');
    expect(config.maxDepth).toBe(7);
    // defaults still apply for keys not in the file
    expect(config.maxAutoRounds).toBe(10);
  });

  it('env vars like DEEP_AGENT_PORT override values from the file', () => {
    const xdg = join(root, 'xdg');
    process.env.XDG_CONFIG_HOME = xdg;
    const configDir = join(xdg, 'deep-agent');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ port: 9999, host: '0.0.0.0', maxDepth: 7 }),
    );

    process.env.DEEP_AGENT_PORT = '4321';
    process.env.DEEP_AGENT_HOST = '10.0.0.1';

    const config = loadConfig();
    expect(config.port).toBe(4321);
    expect(config.host).toBe('10.0.0.1');
    // file value that is not overridden by env still applies
    expect(config.maxDepth).toBe(7);
  });
});
