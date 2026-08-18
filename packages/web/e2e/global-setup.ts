import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

declare global {
  // eslint-disable-next-line no-var
  var __e2e: {
    dataDir: string;
    provider: ChildProcess;
    host: ChildProcess;
  };
}

export default function globalSetup(): void {
  // 1) build the web dist so the host can serve the GUI
  execSync('pnpm --filter @deep-agent/web build', { cwd: ROOT, stdio: 'inherit' });

  const dataDir = mkdtempSync(join(tmpdir(), 'deep-agent-e2e-'));
  writeFileSync(
    join(dataDir, 'config.json'),
    JSON.stringify({
      port: 3900,
      host: '127.0.0.1',
      dataDir: dataDir,
      provider: {
        id: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:3990',
        apiKey: 'fake-key',
        model: 'fake-pro',
        temperature: 0,
      },
      wallet: {
        budgetUsd: 5,
        rates: {
          'fake-flash': { inputPerMUsd: 0.1, outputPerMUsd: 0.3 },
          'fake-pro': { inputPerMUsd: 0.2, outputPerMUsd: 0.6 },
        },
      },
    }),
  );

  const provider = spawn('node', [join(HERE, 'fake-provider.cjs')], { stdio: 'ignore' });
  const host = spawn(
    'node',
    [join(ROOT, 'packages/cli/dist/bin/deep-agent.js'), 'serve', '--config', join(dataDir, 'config.json')],
    { stdio: 'ignore', env: { ...process.env } },
  );
  globalThis.__e2e = { dataDir, provider, host };
  // Block until the host answers /api/health.
  const deadline = Date.now() + 15000;
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  (async () => {
    for (;;) {
      if (Date.now() > deadline) throw new Error('host did not come up within 15s');
      const ok = await new Promise<boolean>((resolve) => {
        const req = get('http://127.0.0.1:3900/api/health', (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
      });
      if (ok) return;
      await sleep(200);
    }
  })();
  // Global setup cannot await top-level; the first test polls health itself.
}
