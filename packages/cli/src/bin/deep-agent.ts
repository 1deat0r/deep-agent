#!/usr/bin/env node
import { resolve } from 'node:path';
import { createHost, loadConfig } from '@deep-agent/host';

function usage(): void {
  console.log(`deep-agent ${'0.1.0'} — an RLM agent harness (DeepSeek-Harness-style UI, prime-agent-style core)

Usage:
  deep-agent serve [options]     Start the host + web UI
  deep-agent skills list         List installed skills
  deep-agent skills install <dir>  Install a skill from a directory with SKILL.md
  deep-agent skills path         Print the skills directory
  deep-agent --help

Options (serve):
  --config <path>        JSON config file
  --port <n>             Override the listen port
  --host <addr>          Override the listen address
  --data-dir <path>      Where sessions live
  --provider <id>        "openai-compatible" (default) or "mock"
  --model <name>         Model name (default deepseek-chat)
  --base-url <url>       OpenAI-compatible endpoint (default https://api.deepseek.com)

Environment:
  DEEP_AGENT_CONFIG, DEEP_AGENT_PORT, DEEP_AGENT_DATA_DIR, DEEP_AGENT_API_KEY,
  DEEP_AGENT_MODEL, DEEP_AGENT_BASE_URL, DEEP_AGENT_PYTHON, DEEP_AGENT_PYTHON_DIR,
  DEEP_AGENT_SKILLS_DIR
`);
}

interface ParsedArgs {
  config?: string;
  overrides: Record<string, unknown>;
  positionals: string[];
}

function parseArgs(argv: string[], options: { allowPositionals?: boolean } = {}): ParsedArgs {
  const out: ParsedArgs = { overrides: {}, positionals: [] };
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
    if (!flag.startsWith('--')) {
      if (options.allowPositionals) {
        out.positionals.push(flag);
        continue;
      }
      throw new Error(`unexpected argument: ${flag}`);
    }
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
  if (command === 'skills') {
    await runSkillsCommand(rest);
    return;
  }
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
    const hardExit = setTimeout(() => process.exit(0), 3000);
    hardExit.unref();
    try {
      await host.manager.disposeAll();
      await host.server.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

async function runSkillsCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args, { allowPositionals: true });
  if (parsed.config) process.env.DEEP_AGENT_CONFIG = resolve(parsed.config);
  const config = loadConfig(parsed.overrides as Parameters<typeof loadConfig>[0]);
  const host = createHost(config);
  const [sub, ...positionals] = parsed.positionals;

  switch (sub) {
    case 'list': {
      const skills = host.skills.list();
      console.log(`${skills.length} skills in ${host.skills.dir}`);
      for (const skill of skills) {
        console.log(`  ${skill.name}\t${skill.description.trim().slice(0, 80)}`);
      }
      return;
    }
    case 'install': {
      const source = positionals[0];
      if (!source) throw new Error('skills install requires a source directory');
      const installed = host.skills.install(source);
      console.log(`installed ${installed.name} from ${resolve(source)}`);
      return;
    }
    case 'path':
      console.log(host.skills.dir);
      return;
    default:
      console.error(`usage: deep-agent skills <list|install <dir>|path> [--config <path>] [--data-dir <path>]`);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[deep-agent] fatal: ${(error as Error).message}`);
  process.exit(1);
});
