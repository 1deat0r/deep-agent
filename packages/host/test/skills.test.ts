import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { SkillsRegistry } from '../src/skills.js';
import { systemPrompt } from '../src/system-prompt.js';

let root: string;
let bundled: string;
let installed: string;

function writeSkill(dir: string, name: string, description: string, body = '# body') {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(
    join(dir, name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'deep-agent-skills-'));
  bundled = join(root, 'bundled');
  installed = join(root, 'installed');
  mkdirSync(bundled, { recursive: true });
});

describe('SkillsRegistry', () => {
  it('seeds bundled skills that are missing, and is idempotent', () => {
    writeSkill(bundled, 'tdd', 'Test-driven development');
    writeSkill(bundled, 'research', 'Investigate a question');
    const registry = new SkillsRegistry({ dir: installed, bundledDir: bundled });
    const first = registry.seedBundled().sort();
    expect(first).toEqual(['research', 'tdd']);
    expect(registry.seedBundled()).toEqual([]);
    expect(existsSync(join(installed, 'tdd', 'SKILL.md'))).toBe(true);
  });

  it('lists names and descriptions from frontmatter', () => {
    writeSkill(bundled, 'tdd', 'Test-driven development');
    const registry = new SkillsRegistry({ dir: installed, bundledDir: bundled });
    registry.seedBundled();
    expect(registry.list()).toEqual([{ name: 'tdd', description: 'Test-driven development' }]);
  });

  it('loads the full SKILL.md and rejects unknown or unsafe names', () => {
    writeSkill(bundled, 'tdd', 'TDD', '# full instructions');
    const registry = new SkillsRegistry({ dir: installed, bundledDir: bundled });
    registry.seedBundled();
    const loaded = registry.load('tdd');
    expect(loaded.name).toBe('tdd');
    expect(loaded.content).toContain('full instructions');
    expect(() => registry.load('nope')).toThrow(/unknown skill/);
    expect(() => registry.load('../etc')).toThrow(/invalid skill name/);
  });

  it('installs a skill from a directory and rejects duplicates/traversal', () => {
    const source = join(root, 'custom-skill');
    mkdirSync(source, { recursive: true });
    writeFileSync(
      join(source, 'SKILL.md'),
      '---\nname: custom\ndescription: A custom skill\n---\n\n# custom body\n',
    );
    const registry = new SkillsRegistry({ dir: installed });
    const info = registry.install(source);
    expect(info).toEqual({ name: 'custom', description: 'A custom skill' });
    expect(existsSync(join(installed, 'custom', 'SKILL.md'))).toBe(true);
    expect(() => registry.install(source)).toThrow(/already installed/);

    // directory without SKILL.md
    const bogus = join(root, 'bogus');
    mkdirSync(bogus);
    expect(() => registry.install(bogus)).toThrow(/no SKILL\.md/);

    // frontmatter name that is a traversal attempt
    writeSkill(root, 'evil', '', '', undefined);
    writeFileSync(
      join(root, 'evil', 'SKILL.md'),
      '---\nname: ../escape\ndescription: x\n---\n',
    );
    expect(() => registry.install(join(root, 'evil'))).toThrow(/invalid skill name/);
  });
});

describe('systemPrompt skills catalog', () => {
  it('includes skill metadata and load instructions', () => {
    const prompt = systemPrompt({
      sessionId: 's',
      role: 'root',
      workspaceDir: '/w',
      parentName: null,
      goalObjective: null,
      skills: [{ name: 'tdd', description: 'Test-driven development' }],
    });
    expect(prompt).toContain('## Skills');
    expect(prompt).toContain('`tdd`: Test-driven development');
    expect(prompt).toContain('await rlm.skills.load("<name>")');
  });

  it('shows the install hint when no skills are installed', () => {
    const prompt = systemPrompt({
      sessionId: 's',
      role: 'root',
      workspaceDir: '/w',
      parentName: null,
      goalObjective: null,
      skills: [],
    });
    expect(prompt).toContain('rlm.skills.install');
  });
});
