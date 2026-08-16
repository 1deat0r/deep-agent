import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import {
  ConfigWriteError,
  configFileBase,
  mergeProviderSettings,
  providerEnvOverrides,
  writeConfigFile,
} from '../src/config-write.js';

function baseConfig() {
  return structuredClone(DEFAULT_CONFIG);
}

describe('mergeProviderSettings', () => {
  it('merges the four provider fields and reports changed', () => {
    const base = baseConfig();
    const { config, changed } = mergeProviderSettings(base, {
      id: 'openai-compatible',
      model: 'deepseek-v4-r1',
      apiKey: 'sk-new',
      baseUrl: 'https://example.com/v1',
    });
    expect(changed).toBe(true);
    expect(config.provider).toEqual({
      id: 'openai-compatible',
      model: 'deepseek-v4-r1',
      apiKey: 'sk-new',
      baseUrl: 'https://example.com/v1',
      temperature: 0.3,
    });
    // the input config is not mutated
    expect(base.provider.model).toBe('deepseek-v4-flash');
    // non-provider fields are preserved
    expect(config.port).toBe(3824);
  });

  it('reports changed=false and leaves the config untouched for identical input', () => {
    const base = baseConfig();
    base.provider.apiKey = 'sk-existing';
    const { config, changed } = mergeProviderSettings(base, { model: 'deepseek-v4-flash' });
    expect(changed).toBe(false);
    expect(config.provider).toEqual(base.provider);
  });

  it('rejects saving changes to a keyless openai-compatible config', () => {
    expect(() => mergeProviderSettings(baseConfig(), { model: 'deepseek-v4-r1' })).toThrowError(
      /apiKey/,
    );
  });

  it('leaves fields untouched when they are undefined', () => {
    const base = baseConfig();
    base.provider.apiKey = 'sk-existing';
    const { config, changed } = mergeProviderSettings(base, {
      id: undefined,
      model: undefined,
      apiKey: undefined,
      baseUrl: undefined,
    });
    expect(changed).toBe(false);
    expect(config.provider.apiKey).toBe('sk-existing');
  });

  it('clears apiKey and baseUrl with empty strings', () => {
    const base = baseConfig();
    base.provider.id = 'mock';
    base.provider.apiKey = 'sk-x';
    base.provider.baseUrl = 'https://api.deepseek.com';
    const { config, changed } = mergeProviderSettings(base, { apiKey: '', baseUrl: '' });
    expect(changed).toBe(true);
    expect(config.provider.apiKey).toBeUndefined();
    expect(config.provider.baseUrl).toBeUndefined();
    expect(config.provider.id).toBe('mock');
  });

  it('rejects clearing the apiKey on openai-compatible', () => {
    const base = baseConfig();
    base.provider.apiKey = 'sk-existing';
    expect(() => mergeProviderSettings(base, { apiKey: '' })).toThrowError(ConfigWriteError);
    try {
      mergeProviderSettings(base, { apiKey: '' });
    } catch (error) {
      expect((error as ConfigWriteError).field).toBe('apiKey');
    }
  });

  it('rejects switching to openai-compatible without an apiKey anywhere', () => {
    const base = baseConfig();
    base.provider.id = 'mock';
    base.provider.apiKey = undefined;
    expect(() => mergeProviderSettings(base, { id: 'openai-compatible' })).toThrowError(
      /apiKey/,
    );
  });

  it('keeps the existing apiKey when switching id and none is given', () => {
    const base = baseConfig();
    base.provider.id = 'mock';
    base.provider.apiKey = 'sk-kept';
    const { config, changed } = mergeProviderSettings(base, { id: 'openai-compatible' });
    expect(changed).toBe(true);
    expect(config.provider.id).toBe('openai-compatible');
    expect(config.provider.apiKey).toBe('sk-kept');
  });

  it('allows the mock provider without an apiKey', () => {
    const base = baseConfig();
    const { config, changed } = mergeProviderSettings(base, { id: 'mock' });
    expect(changed).toBe(true);
    expect(config.provider.id).toBe('mock');
  });

  it('rejects an unknown provider id with field id', () => {
    expect(() => mergeProviderSettings(baseConfig(), { id: 'anthropic' })).toThrowError(
      /unknown provider id/,
    );
    try {
      mergeProviderSettings(baseConfig(), { id: 'anthropic' });
    } catch (error) {
      expect((error as ConfigWriteError).field).toBe('id');
    }
  });

  it('rejects an empty or non-string model with field model', () => {
    for (const model of ['', '   ', 42]) {
      expect(() => mergeProviderSettings(baseConfig(), { model })).toThrowError(/model/);
      try {
        mergeProviderSettings(baseConfig(), { model });
      } catch (error) {
        expect((error as ConfigWriteError).field).toBe('model');
      }
    }
  });

  it('rejects a non-http(s) or unparseable baseUrl with field baseUrl', () => {
    for (const baseUrl of ['ftp://example.com', 'not a url', 42]) {
      expect(() => mergeProviderSettings(baseConfig(), { baseUrl })).toThrowError(/baseUrl/);
      try {
        mergeProviderSettings(baseConfig(), { baseUrl });
      } catch (error) {
        expect((error as ConfigWriteError).field).toBe('baseUrl');
      }
    }
  });

  it('rejects a non-string apiKey with field apiKey', () => {
    expect(() => mergeProviderSettings(baseConfig(), { apiKey: 123 })).toThrowError(/apiKey/);
    try {
      mergeProviderSettings(baseConfig(), { apiKey: 123 });
    } catch (error) {
      expect((error as ConfigWriteError).field).toBe('apiKey');
    }
  });

  it('rejects non-object input', () => {
    for (const input of ['x', 42, null, [1, 2]]) {
      expect(() => mergeProviderSettings(baseConfig(), input)).toThrowError(ConfigWriteError);
    }
  });

  it('ignores unknown fields on the input', () => {
    const base = baseConfig();
    base.provider.apiKey = 'sk-existing';
    const { config, changed } = mergeProviderSettings(base, {
      model: 'deepseek-v4-r1',
      bogus: 1,
    });
    expect(changed).toBe(true);
    expect(config.provider.model).toBe('deepseek-v4-r1');
  });

  it('leaves the input config untouched when validation throws', () => {
    const base = baseConfig();
    expect(() => mergeProviderSettings(base, { id: 'anthropic' })).toThrowError();
    expect(base.provider.id).toBe('openai-compatible');
  });
});

describe('writeConfigFile', () => {
  let root: string;
  let path: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'deep-agent-config-write-'));
    path = join(root, 'config.json');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes the config as parseable JSON with 0600 permissions', () => {
    const config = baseConfig();
    config.provider.apiKey = 'sk-written';
    writeConfigFile(path, config);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(config);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('creates missing directories along the path', () => {
    const nested = join(root, 'deep-agent', 'config.json');
    writeConfigFile(nested, baseConfig());
    expect(JSON.parse(readFileSync(nested, 'utf8')).port).toBe(3824);
  });

  it('replaces an existing file and leaves no temp files behind', () => {
    writeFileSync(path, 'old content');
    const config = baseConfig();
    config.port = 4321;
    writeConfigFile(path, config);
    expect(JSON.parse(readFileSync(path, 'utf8')).port).toBe(4321);
    expect(readdirSync(root)).toEqual(['config.json']);
  });

  it('enforces 0600 even when the existing file had other permissions', () => {
    writeFileSync(path, '{}', { mode: 0o644 });
    writeConfigFile(path, baseConfig());
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('leaves an existing file untouched when serialization fails', () => {
    writeFileSync(path, 'sentinel');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => writeConfigFile(path, circular as never)).toThrowError();
    expect(readFileSync(path, 'utf8')).toBe('sentinel');
  });

  it('round-trips extra keys present on the config object', () => {
    const config = { ...baseConfig(), customThing: 'x' };
    writeConfigFile(path, config);
    expect(JSON.parse(readFileSync(path, 'utf8')).customThing).toBe('x');
  });
});

describe('configFileBase', () => {
  let root: string;
  let path: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'deep-agent-config-base-'));
    path = join(root, 'config.json');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('yields the defaults when the file is missing', () => {
    expect(configFileBase(path)).toEqual(DEFAULT_CONFIG);
  });

  it('merges a partial file over defaults, preserving unknown keys and provider fields', () => {
    writeFileSync(
      path,
      JSON.stringify({
        port: 9999,
        customThing: 'x',
        provider: { model: 'other-model', apiKey: 'sk-file' },
      }),
    );
    const base = configFileBase(path);
    expect(base.port).toBe(9999);
    expect((base as unknown as { customThing: string }).customThing).toBe('x');
    expect(base.provider.model).toBe('other-model');
    expect(base.provider.apiKey).toBe('sk-file');
    expect(base.provider.id).toBe('openai-compatible');
    expect(base.maxDepth).toBe(3);
  });

  it('yields the defaults when the file is malformed', () => {
    writeFileSync(path, '{not json');
    expect(configFileBase(path)).toEqual(DEFAULT_CONFIG);
  });
});

describe('providerEnvOverrides', () => {
  it('reports nothing when no provider env vars are set', () => {
    expect(providerEnvOverrides({})).toEqual([]);
  });

  it('reports the set provider env vars in stable order', () => {
    expect(
      providerEnvOverrides({
        DEEP_AGENT_API_KEY: 'k',
        DEEP_AGENT_MODEL: 'm',
        DEEP_AGENT_BASE_URL: 'u',
      }),
    ).toEqual(['DEEP_AGENT_API_KEY', 'DEEP_AGENT_MODEL', 'DEEP_AGENT_BASE_URL']);
  });

  it('ignores empty-string env vars', () => {
    expect(providerEnvOverrides({ DEEP_AGENT_MODEL: '' })).toEqual([]);
  });

  it('defaults to process.env when no env is given', () => {
    const saved = process.env.DEEP_AGENT_MODEL;
    process.env.DEEP_AGENT_MODEL = 'm';
    try {
      expect(providerEnvOverrides()).toEqual(['DEEP_AGENT_MODEL']);
    } finally {
      if (saved === undefined) delete process.env.DEEP_AGENT_MODEL;
      else process.env.DEEP_AGENT_MODEL = saved;
    }
  });
});
