import { rmSync } from 'node:fs';

export default function globalTeardown(): void {
  const e2e = globalThis.__e2e;
  if (!e2e) return;
  e2e.host.kill();
  e2e.provider.kill();
  rmSync(e2e.dataDir, { recursive: true, force: true });
}
