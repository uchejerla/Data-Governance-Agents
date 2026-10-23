import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// The guard is only worth having if it actually blocks the moves agents make to
// reach green. These tests build a throwaway repository, apply one such move, and
// assert on the exit code the guard returns.

const GUARD = fileURLToPath(new URL('./check-constraints.mjs', import.meta.url));
const repos = [];

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'constraints-'));
  repos.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base'],
    { cwd: dir },
  );
  return dir;
}

function runGuard(dir, base = 'HEAD') {
  try {
    const stdout = execFileSync(process.execPath, [GUARD, '--base', base], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') };
  }
}

const BASE_FILES = {
  'src/app.ts': 'export const value = 1;\n',
  'tests/app.test.ts': "import { expect, it } from 'vitest';\nit('works', () => { expect(1).toBe(1); });\n",
  'CONSTRAINTS.md': [
    '# Constraints',
    '',
    '| Dimension | Rule | Checked by | Runs at |',
    '| --- | --- | --- | --- |',
    '| Tests | At least 73 tests pass | `npm test` | CI |',
    '',
  ].join('\n'),
  '.github/workflows/ci.yml': 'jobs:\n  verify:\n    steps:\n      - run: npm test\n',
};

afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('constraint floor guard', () => {
  it('passes a clean tree', () => {
    const dir = makeRepo(BASE_FILES);
    const result = runGuard(dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('clean');
  });

  it('blocks a new suppression comment', () => {
    const dir = makeRepo(BASE_FILES);
    writeFileSync(join(dir, 'src/app.ts'), '// @ts-ignore\nexport const value = 1;\n');
    const result = runGuard(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('silenced-checker');
  });

  it('sees an untracked file, not only the tracked diff', () => {
    const dir = makeRepo(BASE_FILES);
    writeFileSync(join(dir, 'src/stub.ts'), 'export const notYet = () => {\n  throw new Error("Not implemented");\n};\n');
    const result = runGuard(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('unfinished-work');
  });

  it('blocks a deleted test file', () => {
    const dir = makeRepo(BASE_FILES);
    unlinkSync(join(dir, 'tests/app.test.ts'));
    const result = runGuard(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('test-deleted');
  });

  it('blocks a loosened threshold in CONSTRAINTS.md', () => {
    const dir = makeRepo(BASE_FILES);
    writeFileSync(
      join(dir, 'CONSTRAINTS.md'),
      [
        '# Constraints',
        '',
        '| Dimension | Rule | Checked by | Runs at |',
        '| --- | --- | --- | --- |',
        '| Tests | At least 60 tests pass | `npm test` | CI |',
        '',
      ].join('\n'),
    );
    const result = runGuard(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('threshold-loosened');
  });

  it('blocks a gate disabled in CI', () => {
    const dir = makeRepo(BASE_FILES);
    writeFileSync(
      join(dir, '.github/workflows/ci.yml'),
      'jobs:\n  verify:\n    steps:\n      - run: npm test\n        continue-on-error: true\n',
    );
    const result = runGuard(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('disabled-gate');
  });

  it('lets prose mention the patterns it documents', () => {
    const dir = makeRepo(BASE_FILES);
    const notes = join(dir, 'docs/notes.md');
    mkdirSync(dirname(notes), { recursive: true });
    writeFileSync(notes, 'Never add @ts-ignore or a // TODO to pass a gate.\n');
    const result = runGuard(dir);
    expect(result.code).toBe(0);
  });

  it('exits 2, never 0, when it cannot run', () => {
    const dir = makeRepo(BASE_FILES);
    const result = runGuard(dir, 'no-such-ref');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('no merge base');
  });
});

// A count that goes up is the ratchet working, not a move to reach green. These
// tests cover the reads that tell the two apart, so raising a documented number
// stays silent while every way of lowering one still blocks.
describe('threshold direction', () => {
  const floor = (rule) =>
    [
      '# Constraints',
      '',
      '| Dimension | Rule | Checked by | Runs at |',
      '| --- | --- | --- | --- |',
      `| Tests | ${rule} | \`npm test\` | CI |`,
      '',
    ].join('\n');

  const measured = (today, direction) =>
    [
      '# Constraints',
      '',
      '| Metric | Today | Direction |',
      '| --- | --- | --- |',
      `| Tests | ${today} | ${direction} |`,
      '',
    ].join('\n');

  it('lets a raised floor through', () => {
    const dir = makeRepo({ ...BASE_FILES, 'CONSTRAINTS.md': floor('At least 73 tests pass') });
    writeFileSync(join(dir, 'CONSTRAINTS.md'), floor('At least 91 tests pass'));
    const result = runGuard(dir);
    expect(result.code).toBe(0);
  });

  it('still blocks the same floor going down', () => {
    const dir = makeRepo({ ...BASE_FILES, 'CONSTRAINTS.md': floor('At least 91 tests pass') });
    writeFileSync(join(dir, 'CONSTRAINTS.md'), floor('At least 73 tests pass'));
    const result = runGuard(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('threshold-loosened');
  });

  it('reads a direction word written in the cell beside the number', () => {
    const dir = makeRepo({
      ...BASE_FILES,
      'CONSTRAINTS.md': measured('81 passing, 9 files', 'must not fall'),
    });
    writeFileSync(join(dir, 'CONSTRAINTS.md'), measured('91 passing, 9 files', 'must not fall'));
    expect(runGuard(dir).code).toBe(0);

    writeFileSync(join(dir, 'CONSTRAINTS.md'), measured('60 passing, 9 files', 'must not fall'));
    const lowered = runGuard(dir);
    expect(lowered.code).toBe(1);
    expect(lowered.stderr).toContain('threshold-loosened');
  });

  it('pairs two rows that share a label by position, not by first match', () => {
    // Both are called `Tests`; a first-match pairing compares the measured row
    // against the floor row and calls a rise a loosening.
    const both = (floorRule, today) =>
      [floor(floorRule), measured(today, 'must not fall')].join('\n');
    const dir = makeRepo({
      ...BASE_FILES,
      'CONSTRAINTS.md': both('At least 73 tests pass', '95 passing, 9 files'),
    });
    writeFileSync(
      join(dir, 'CONSTRAINTS.md'),
      both('At least 91 tests pass', '101 passing, 9 files'),
    );
    const result = runGuard(dir);
    expect(result.code).toBe(0);
  });

  it('blocks a threshold that is deleted even though the row survives', () => {
    const row = (rule) =>
      [
        '# Constraints',
        '',
        '| Metric | Today | Direction |',
        '| --- | --- | --- |',
        `| Bundle | ${rule} | must not grow |`,
        '',
      ].join('\n');
    const dir = makeRepo({ ...BASE_FILES, 'CONSTRAINTS.md': row('390.73 kB (117.55 kB gzip)') });
    writeFileSync(join(dir, 'CONSTRAINTS.md'), row('small enough, gzip too'));
    const result = runGuard(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('threshold-removed');
  });

  it('ignores numbers in the cells beside the threshold', () => {
    // `CI from CP2` is a checkpoint, not a threshold: rewording the row must not
    // read as a number being removed.
    const row = (rule, runsAt) =>
      [
        '# Constraints',
        '',
        '| Dimension | Rule | Checked by | Runs at |',
        '| --- | --- | --- | --- |',
        `| Dependencies | ${rule} | \`npm audit --audit-level=high\` | ${runsAt} |`,
        '',
      ].join('\n');
    const dir = makeRepo({
      ...BASE_FILES,
      'CONSTRAINTS.md': row('No high or critical advisory reachable at runtime', 'CI from CP2'),
    });
    writeFileSync(
      join(dir, 'CONSTRAINTS.md'),
      row('Nothing at high or above, runtime or development', 'every change, CI'),
    );
    expect(runGuard(dir).code).toBe(0);
  });

  it('still reports a change it cannot read a direction from', () => {
    const row = (value) =>
      [
        '# Constraints',
        '',
        '| Metric | Today | Direction |',
        '| --- | --- | --- |',
        `| Coverage | ${value} | recorded by hand |`,
        '',
      ].join('\n');
    const dir = makeRepo({ ...BASE_FILES, 'CONSTRAINTS.md': row('80% of lines') });
    writeFileSync(join(dir, 'CONSTRAINTS.md'), row('70% of lines'));
    const result = runGuard(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('threshold-changed');
  });

  it('blocks a floor that flips into a ceiling', () => {
    const row = (rule) =>
      [
        '# Constraints',
        '',
        '| Metric | Today | Direction |',
        '| --- | --- | --- |',
        `| Budget | ${rule} | fixed |`,
        '',
      ].join('\n');
    const dir = makeRepo({ ...BASE_FILES, 'CONSTRAINTS.md': row('at most 400 kB') });
    writeFileSync(join(dir, 'CONSTRAINTS.md'), row('at least 300 kB'));
    const result = runGuard(dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('threshold-changed');
  });
});
