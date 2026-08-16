import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SkillInfo {
  name: string;
  description: string;
}

export interface SkillContent {
  name: string;
  /** The full SKILL.md text. */
  content: string;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MAX_SKILL_BYTES = 256 * 1024;

function parseFrontmatter(text: string): {
  name: string | undefined;
  description: string | undefined;
} {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { name: undefined, description: undefined };
  const out: Record<string, string> = {};
  for (const line of match[1]?.split('\n') ?? []) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === 'name' || key === 'description') out[key] = value;
  }
  return { name: out.name, description: out.description };
}

function readSkillInfo(dir: string, name: string): SkillInfo | null {
  const path = join(dir, name, 'SKILL.md');
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  const { name: fmName, description } = parseFrontmatter(text);
  return {
    name: fmName ?? name,
    description: description ?? '',
  };
}

function requireSafeName(name: string): string {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `invalid skill name "${name}": must match ^[a-z0-9][a-z0-9-]*$ (lowercase)`,
    );
  }
  return name;
}

/**
 * Where the bundled skill suite lives. Resolution order:
 * 1. `<repo>/skills` — the canonical suite in a source checkout (this module
 *    sits at packages/host/{src,dist}, three levels under the repo root).
 * 2. `<package>/skills` — the copy synced into the host package for npm
 *    installs (see `prepack` in packages/host/package.json).
 * Returns undefined when neither exists, so seeding degrades to a no-op.
 */
export function defaultBundledSkillsDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoCandidate = resolve(here, '..', '..', '..', 'skills');
  if (existsSync(repoCandidate)) return repoCandidate;
  const packageCandidate = resolve(here, '..', '..', 'skills');
  if (existsSync(packageCandidate)) return packageCandidate;
  return undefined;
}

/**
 * Owns the skills the agent can reach: an on-disk directory of `SKILL.md`
 * packages (the Agent Skills format), seeded from the bundled suite, listable,
 * loadable on demand, and extensible at runtime through `install`.
 */
export class SkillsRegistry {
  readonly dir: string;
  private readonly bundledDir: string | undefined;

  constructor(options: { dir: string; bundledDir: string | undefined }) {
    this.dir = options.dir;
    this.bundledDir = options.bundledDir;
    mkdirSync(this.dir, { recursive: true });
  }

  /** Copy bundled skills that are not yet installed. Returns names seeded. */
  seedBundled(): string[] {
    if (!this.bundledDir || !existsSync(this.bundledDir)) return [];
    const seeded: string[] = [];
    for (const entry of readdirSync(this.bundledDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (!NAME_PATTERN.test(name)) continue;
      if (existsSync(join(this.dir, name))) continue;
      const source = join(this.bundledDir, name);
      if (!existsSync(join(source, 'SKILL.md'))) continue;
      cpSync(source, join(this.dir, name), { recursive: true });
      seeded.push(name);
    }
    return seeded;
  }

  list(): SkillInfo[] {
    const skills: SkillInfo[] = [];
    for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const info = readSkillInfo(this.dir, entry.name);
      if (info) skills.push(info);
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return skills;
  }

  has(name: string): boolean {
    return existsSync(join(this.dir, requireSafeName(name), 'SKILL.md'));
  }

  load(name: string): SkillContent {
    const safe = requireSafeName(name);
    const path = join(this.dir, safe, 'SKILL.md');
    if (!existsSync(path)) {
      throw new Error(`unknown skill "${safe}" — use rlm.skills.list() to see installed skills`);
    }
    const content = readFileSync(path, 'utf8');
    if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_BYTES) {
      throw new Error(`skill "${safe}" exceeds the ${MAX_SKILL_BYTES}-byte load limit`);
    }
    const { name: fmName } = parseFrontmatter(content);
    return { name: fmName ?? safe, content };
  }

  /**
   * Install a skill from a directory containing SKILL.md (the model can fetch
   * or write one in its workspace, then hand it to the host, which validates
   * and copies it — the kernel never writes outside its workspace).
   */
  install(sourcePath: string): SkillInfo {
    const source = resolve(sourcePath);
    if (!existsSync(source) || !existsSync(join(source, 'SKILL.md'))) {
      throw new Error(`no SKILL.md found at ${source}`);
    }
    const text = readFileSync(join(source, 'SKILL.md'), 'utf8');
    const { name, description } = parseFrontmatter(text);
    const safe = requireSafeName(name ?? basename(source));
    if (existsSync(join(this.dir, safe))) {
      throw new Error(`skill "${safe}" is already installed`);
    }
    cpSync(source, join(this.dir, safe), { recursive: true });
    return { name: safe, description: description ?? '' };
  }
}
