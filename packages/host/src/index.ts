import type { LlmClient } from '@deep-agent/provider';
import { OpenAICompatibleClient } from '@deep-agent/provider';
import { DEFAULT_CONFIG, loadConfig, sessionsRoot } from './config.js';
import { EchoLlmClient } from './mock-client.js';
import { EventBus } from './events.js';
import { AgentManager } from './manager.js';
import { HostServer } from './server.js';
import { SessionStore } from './store.js';

export interface Host {
  config: ReturnType<typeof loadConfig>;
  manager: AgentManager;
  server: HostServer;
  events: EventBus;
}

export function buildClient(config: Host['config']): LlmClient {
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
    model: config.provider.model,
    temperature: config.provider.temperature ?? 0.3,
    maxTokens: config.provider.maxTokens,
    defaultHeaders: undefined,
  });
}

export function createHost(
  config = loadConfig(),
  clientFactory?: (
    config: Host['config'],
    ctx: { role: 'root' | 'child' },
  ) => LlmClient,
): Host {
  const events = new EventBus();
  const store = new SessionStore(sessionsRoot(config));
  let client: LlmClient;
  try {
    client = clientFactory ? clientFactory(config, { role: 'root' }) : buildClient(config);
  } catch (error) {
    if (config.provider.id === 'openai-compatible' && !config.provider.apiKey) {
      // Degrade to mock so the harness still boots and the GUI can guide setup.
      client = new EchoLlmClient();
      console.warn(`[deep-agent] ${(error as Error).message} — falling back to mock provider`);
    } else {
      throw error;
    }
  }
  const manager = new AgentManager(store, events, config, (ctx) =>
    clientFactory ? clientFactory(config, ctx) : client,
  );
  manager.loadAll();
  const server = new HostServer({ config, manager });
  return { config, manager, server, events };
}

export * from './types.js';
export { loadConfig, DEFAULT_CONFIG, sessionsRoot } from './config.js';
export { EventBus } from './events.js';
export { AgentManager } from './manager.js';
export { AgentSession } from './session.js';
export { SessionStore } from './store.js';
export { HostServer } from './server.js';
export { systemPrompt } from './system-prompt.js';
export { EchoLlmClient } from './mock-client.js';
