#!/usr/bin/env node
import { resolve } from 'node:path';
import { createHost, loadConfig } from '@deep-agent/host';

function usage(): void {
  console.log(`deep-agent ${'0.1.0'} — an RLM agent harness (DeepSeek-Harness-style UI, prime-agent-style core)

Usage:
  deep-agent serve [options]     Start the host + web UI
  deep-agent --help

Options:
  --config <path>        JSON config file
  --port <n>             Override the listen port
  --host <addr>          Override the listen address
  --data-dir <path>      Where sessions live
  --provider <id>        "openai-compatible" (default) or "mock"
  --model <name>         Model name (default deepseek-chat)
  --base-url <url>       OpenAI-compatible endpoint (default https://api.deepseek.com)

Environment:
  DEEP_AGENT_CONFIG, DEEP_AGENT_PORT, DEEP_AGENT_DATA_DIR, DEEP_AGENT_API_KEY,
  DEEP_AGENT_MODEL, DEEP_AGENT_BASE_URL, DEEP_AGENT_PYTHON, DEEP_AGENT_PYTHON_DIR
`);
}

interface ParsedArgs {
  config?: string;
  overrides: Record<string, unknown>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { overrides: {} };
  const valueFlags = new Set([
    '--config',
    '--port',
    '--host',
    '--data-dir',
    '--provider',
    '--model',
    '--base-url',
  ]);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] ?? '';
    if (!valueFlags.has(flag)) {
      throw new Error(`unknown argument: ${flag}`);
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} requires a value`);
    switch (flag) {
      case '--config':
        out.config = value;
        break;
      case '--port':
        out.overrides.port = Number(value);
        break;
      case '--host':
        out.overrides.host = value;
        break;
      case '--data-dir':
        out.overrides.dataDir = value;
        break;
      case '--provider':
        out.overrides.provider = { id: value };
        break;
      case '--model':
        out.overrides.provider = { ...(out.overrides.provider as object), model: value };
        break;
      case '--base-url':
        out.overrides.provider = { ...(out.overrides.provider as object), baseUrl: value };
        break;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }
  const [command, ...rest] = argv;
  if (command !== 'serve') {
    usage();
    process.exitCode = 1;
    return;
  }

  let args: ParsedArgs;
  try {
    args = parseArgs(rest);
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  if (args.config) process.env.DEEP_AGENT_CONFIG = resolve(args.config);

  const config = loadConfig(args.overrides as Parameters<typeof loadConfig>[0]);
  if (config.provider.id === 'openai-compatible' && !config.provider.apiKey) {
    console.warn(
      '[deep-agent] no API key set (DEEP_AGENT_API_KEY or provider.apiKey) — falling back to the mock provider',
    );
  }
  const host = createHost(config);
  const { port, host: addr } = await host.server.start();
  console.log(`[deep-agent] serving http://${addr}:${port}`);
  console.log(`[deep-agent] sessions: ${config.dataDir}`);
  console.log(`[deep-agent] provider: ${config.provider.id} (${config.provider.model})`);

  const shutdown = async (): Promise<void> => {
    console.log('\n[deep-agent] shutting down');
    await host.manager.disposeAll();
    await host.server.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  console.error(`[deep-agent] fatal: ${(error as Error).message}`);
  process.exit(1);
});
