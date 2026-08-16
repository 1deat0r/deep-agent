import type { LlmClient } from '@deep-agent/provider';
import { OpenAICompatibleClient } from '@deep-agent/provider';
import { DEFAULT_CONFIG, loadConfig, sessionsRoot } from './config.js';
import { EchoLlmClient } from './mock-client.js';
import { EventBus } from './events.js';
import { AgentManager } from './manager.js';
import { HostServer } from './server.js';
import { SessionStore } from './store.js';
import { defaultBundledSkillsDir, SkillsRegistry } from './skills.js';
import { join } from 'node:path';

export interface Host {
  config: ReturnType<typeof loadConfig>;
  manager: AgentManager;
  server: HostServer;
  events: EventBus;
  skills: SkillsRegistry;
}

export function buildClient(config: Host['config'], model?: string): LlmClient {
  if (config.provider.id === 'mock') return new EchoLlmClient();
  const apiKey = config.provider.apiKey ?? process.env.DEEP_AGENT_API_KEY;
  if (!apiKey) {
    throw new Error(
      'no API key configured: set provider.apiKey in config, DEEP_AGENT_API_KEY, or provider id "mock"',
    );
  }
  return new OpenAICompatibleClient({
    baseUrl: config.provider.baseUrl ?? 'https://api.deepseek.com',
    apiKey,
    model: model ?? config.provider.model,
    temperature: config.provider.temperature ?? 0.3,
    maxTokens: config.provider.maxTokens,
    defaultHeaders: undefined,
  });
}

export function createHost(
  config = loadConfig(),
  clientFactory?: (
    config: Host['config'],
    ctx: { role: 'root' | 'child'; model: string },
  ) => LlmClient,
): Host {
  const events = new EventBus();
  const store = new SessionStore(sessionsRoot(config));
  let client: LlmClient;
  try {
    client = clientFactory
      ? clientFactory(config, { role: 'root', model: config.provider.model })
      : buildClient(config);
  } catch (error) {
    if (config.provider.id === 'openai-compatible' && !config.provider.apiKey) {
      // Degrade to mock so the harness still boots and the GUI can guide setup.
      client = new EchoLlmClient();
      console.warn(`[deep-agent] ${(error as Error).message} — falling back to mock provider`);
    } else {
      throw error;
    }
  }
  const skills = new SkillsRegistry({
    dir: config.skillsDir ?? join(config.dataDir, 'skills'),
    bundledDir: defaultBundledSkillsDir(),
  });
  const seeded = skills.seedBundled();
  if (seeded.length > 0) {
    console.log(`[deep-agent] seeded ${seeded.length} bundled skills into ${skills.dir}`);
  }
  const manager = new AgentManager(store, events, config, skills, (ctx) =>
    clientFactory ? clientFactory(config, ctx) : buildClient(config, ctx.model),
  );
  manager.loadAll();
  const server = new HostServer({ config, manager });
  return { config, manager, server, events, skills };
}

export * from './types.js';
export { loadConfig, DEFAULT_CONFIG, sessionsRoot, defaultConfigPath } from './config.js';
export {
  ConfigWriteError,
  mergeProviderSettings,
  writeConfigFile,
  providerEnvOverrides,
} from './config-write.js';
export type { ProviderSettingsMerge, ProviderEnvOverride } from './config-write.js';
export { EventBus } from './events.js';
export { AgentManager } from './manager.js';
export { AgentSession } from './session.js';
export { SessionStore } from './store.js';
export { HostServer } from './server.js';
export { systemPrompt } from './system-prompt.js';
export { EchoLlmClient } from './mock-client.js';
export { defaultBundledSkillsDir, SkillsRegistry } from './skills.js';
export type { SkillContent, SkillInfo } from './skills.js';
export { estimateTokens } from './tokens.js';
