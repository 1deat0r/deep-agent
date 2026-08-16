// Sync the bundled skill suite into the host package for `pnpm pack` / npm
// publish: the published tarball must carry skills/ so an installed
// @deep-agent/host remains sovereign (defaultBundledSkillsDir falls back to
// <package>/skills). The repo-root skills/ directory stays the canonical
// source; this copy is generated and gitignored.
const { cpSync, rmSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const source = join(__dirname, '..', '..', '..', 'skills');
const target = join(__dirname, '..', 'skills');

if (!existsSync(source)) {
  console.error('[prepack] repo skills/ not found — skipping bundle sync');
  process.exit(0);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`[prepack] synced bundled skills into ${target}`);
