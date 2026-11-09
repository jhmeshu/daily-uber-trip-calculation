import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT_DIRS = ['.agents/agent', '.opencode/agents', '.claude/agents', '.kilo/agent'];
const MAP_KEYS = ['tools', 'permission'];
const READ_ONLY = ['analyst', 'committer'];
type Shape = 'scalar' | 'flow-seq' | 'flow-map' | 'missing';
type Entry = { key: string; shape: Shape; childLines: string[] };

function collectAgentFiles() {
  const seen = new Map<string, string>();
  for (const dir of AGENT_DIRS) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs)) {
      if (!entry.endsWith('.md')) continue;
      const file = join(abs, entry);
      const real = realpathSync(file);
      // The canonical source wins over the symlinked copies that resolve to it.
      if (!seen.has(real) || dir === AGENT_DIRS[0]) seen.set(real, file);
    }
  }
  return [...seen.values()];
}

function scalar(lines: string[], key: string): string | null {
  const prefix = `${key}:`;
  const line = lines.find(candidate => candidate.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : null;
}

function readFrontmatter(file: string): string[] {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return [];
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  return end === -1 ? [] : lines.slice(1, end);
}

function parseEntries(lines: string[]): Entry[] {
  const entries: Entry[] = [];
  lines.forEach((line, index) => {
    if (/^\s/.test(line) || line.trim() === '') return;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/);
    if (!match) return;
    const inline = match[2]!.trim();
    let shape: Shape = 'missing';
    if (inline.startsWith('[')) shape = 'flow-seq';
    else if (inline.startsWith('{')) shape = 'flow-map';
    else if (inline !== '') shape = 'scalar';
    const childLines: string[] = [];
    for (let i = index + 1; i < lines.length; i++) {
      const next = lines[i]!;
      if (next.trim() === '') { childLines.push(next); continue; }
      if (!/^\s/.test(next)) break;
      childLines.push(next);
    }
    if (shape === 'missing' && childLines.some(child => child.trim() !== '')) shape = 'missing';
    entries.push({ key: match[1]!, shape, childLines: childLines.filter(child => child.trim() !== '') });
  });
  return entries;
}

const agentFiles = collectAgentFiles();

test('agents are discoverable through the shared symlinks', () => {
  assert.ok(agentFiles.length > 0, 'no agent files found');
  assert.ok(agentFiles.some(file => file.includes(`${join('.agents', 'agent')}`)));
});

test('every agent has scalar name, description, and mode in frontmatter', () => {
  const missing: string[] = [];
  for (const file of agentFiles) {
    const frontmatter = readFrontmatter(file);
    const entries = parseEntries(frontmatter);
    for (const key of ['name', 'description', 'mode']) {
      const entry = entries.find(candidate => candidate.key === key);
      if (!entry || entry.shape !== 'scalar') missing.push(`${basename(file)}: ${key} must be a scalar`);
    }
    const mode = scalar(frontmatter, 'mode');
    if (mode !== 'subagent' && mode !== 'primary' && mode !== 'all') missing.push(`${basename(file)}: unknown mode ${mode}`);
  }
  assert.deepEqual(missing, []);
});

test('tools and permission are mappings, never scalars or sequences', () => {
  const invalid: string[] = [];
  for (const file of agentFiles) {
    for (const key of MAP_KEYS) {
      const entry = parseEntries(readFrontmatter(file)).find(candidate => candidate.key === key);
      if (!entry) continue;
      if (entry.shape === 'scalar' || entry.shape === 'flow-seq') invalid.push(`${basename(file)}: ${key} is a ${entry.shape}`);
      if (entry.childLines.some(child => child.trim().startsWith('-'))) invalid.push(`${basename(file)}: ${key} contains a sequence`);
    }
  }
  assert.deepEqual(invalid, []);
});

test('read-only agents deny edit so they stay read-only', () => {
  const invalid: string[] = [];
  for (const file of agentFiles) {
    if (!READ_ONLY.includes(basename(file, '.md'))) continue;
    const permission = parseEntries(readFrontmatter(file)).find(entry => entry.key === 'permission');
    if (!permission || !permission.childLines.some(child => /^\s+edit:\s*deny\s*$/.test(child))) invalid.push(basename(file));
  }
  assert.deepEqual(invalid, []);
});

test('agent frontmatter name matches its filename', () => {
  const mismatched: string[] = [];
  for (const file of agentFiles) {
    const declared = scalar(readFrontmatter(file), 'name');
    if (declared !== basename(file, '.md')) mismatched.push(`${basename(file)} declares ${declared}`);
  }
  assert.deepEqual(mismatched, []);
});

test('every skill has valid frontmatter and a SKILL.md filename', () => {
  const skillDir = join(root, '.agents/skills');
  const problems: string[] = [];
  const skills = readdirSync(skillDir).filter(entry => !entry.startsWith('.'));
  assert.ok(skills.length > 0, 'no skills found');
  for (const skill of skills) {
    const file = join(skillDir, skill, 'SKILL.md');
    if (!existsSync(file)) { problems.push(`${skill}: missing SKILL.md`); continue; }
    const frontmatter = readFrontmatter(file);
    const entries = parseEntries(frontmatter);
    if (entries.find(entry => entry.key === 'name')?.shape !== 'scalar') problems.push(`${skill}: name must be a scalar`);
    if (entries.find(entry => entry.key === 'description')?.shape !== 'scalar') problems.push(`${skill}: description must be a scalar`);
    if (scalar(frontmatter, 'name') !== skill) problems.push(`${skill}: declares name ${scalar(frontmatter, 'name')}`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skill)) problems.push(`${skill}: directory name is not lowercase-hyphenated`);
  }
  assert.deepEqual(problems, []);
});

test('every skill directory has a matching slash-command workflow', () => {
  const missing: string[] = [];
  for (const skill of readdirSync(join(root, '.agents/skills'))) {
    if (skill.startsWith('.')) continue;
    if (!existsSync(join(root, '.agents/workflows', `${skill}.md`))) missing.push(skill);
  }
  assert.deepEqual(missing, []);
});

test('every workflow has a scalar description and a known agent', () => {
  const problems: string[] = [];
  for (const file of readdirSync(join(root, '.agents/workflows'))) {
    if (!file.endsWith('.md')) continue;
    const frontmatter = readFrontmatter(join(root, '.agents/workflows', file));
    if (parseEntries(frontmatter).find(entry => entry.key === 'description')?.shape !== 'scalar') problems.push(`${file}: description must be a scalar`);
    const declared = scalar(frontmatter, 'agent');
    if (!['build', 'explore', 'plan'].includes(declared!)) problems.push(`${file}: unknown agent ${declared}`);
  }
  assert.deepEqual(problems, []);
});

test('agent config does not leak references from the ported project', () => {
  // Naming a foreign stack is legitimate only to prohibit it, so prohibition lines are exempt.
  const stale = ['kitchen', 'Prisma', 'Vitest', 'Ant Design', 'Next.js', 'better-sqlite3', 'Dhaka', 'BDT currency', 'formatBDT', 'todayLocal'];
  const prohibiting = /never|no |not |prohibit|instead of|rather than|do not|don't|strictly/i;
  const leaks: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.md')) {
        readFileSync(abs, 'utf8').split(/\r?\n/).forEach((line, index) => {
          if (prohibiting.test(line)) return;
          for (const needle of stale) if (line.includes(needle)) leaks.push(`${abs.replace(`${root}/`, '')}:${index + 1}: ${needle}`);
        });
      }
    }
  };
  walk(join(root, '.agents'));
  assert.deepEqual(leaks, []);
});

test('agent config files stay in sync with the shared agent set', () => {
  const names = new Set(agentFiles.map(file => basename(file, '.md')));
  for (const dir of AGENT_DIRS.slice(1)) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs)) {
      if (!entry.endsWith('.md')) continue;
      assert.ok(names.has(basename(entry, '.md')), `${dir}/${entry} has no counterpart in .agents/agent`);
    }
  }
  for (const config of ['.opencode/opencode.json', '.kilo/kilo.jsonc']) {
    const parsed = JSON.parse(readFileSync(join(root, config), 'utf8'));
    for (const agent of Object.keys(parsed.agent ?? {})) {
      assert.ok(names.has(agent), `${config} registers ${agent}, which is not in .agents/agent`);
    }
  }
});

test('the markdown validator is present and runs', async () => {
  const { execFileSync } = await import('node:child_process');
  const validator = join(root, '.agents/skills/markdown-writer/validate_md.cjs');
  assert.ok(existsSync(validator), 'validate_md.cjs missing');
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    try {
      execFileSync(process.execPath, [validator, join(root, file)], { stdio: 'pipe', env: { ...process.env, MD_VALIDATE_NO_INSTALL: '1' } });
    } catch (err) {
      assert.fail(`${file} failed markdown validation:\n${(err as { stdout?: Buffer }).stdout?.toString() ?? String(err)}`);
    }
  }
});