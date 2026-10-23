#!/usr/bin/env node
// check-constraints.mjs — diff-scoped enforcement of the CONSTRAINTS.md floor.
//
// A green suite does not prove the bar held: an agent can also pass by deleting
// the test, silencing the checker, or moving the threshold. This guard looks only
// at what the diff adds and removes, so tightening is silent and loosening is loud.
//
//   input   the diff from the merge base to the working tree, plus untracked files
//   exit 0  clean
//   exit 1  at least one move that lowers the bar (block the change)
//   exit 2  the guard could not run — never read as clean
//   output  rule, file and a trimmed line; never a matched secret value
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const baseFlag = argv.indexOf('--base');
if (baseFlag > -1 && !argv[baseFlag + 1]) {
  console.error('check-constraints: --base needs a ref, e.g. --base origin/main');
  process.exit(2);
}
const explicitBase = baseFlag > -1;
let base = explicitBase ? argv[baseFlag + 1] : 'origin/main';

const git = (args, { diffExit = false } = {}) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    // `git diff --no-index` exits 1 whenever the sides differ, which is the normal
    // case for a new file, so that output is kept. Any other failure is null, and
    // null must never be treated as clean.
    if (diffExit && error.status === 1 && typeof error.stdout === 'string') return error.stdout;
    return null;
  }
};

const bail = (message) => {
  console.error('check-constraints: ' + message);
  process.exit(2);
};

const top = git(['rev-parse', '--show-toplevel'])?.trim();
if (!top) bail('not inside a git work tree');
process.chdir(top);

// A local worktree without a remote has no origin/main; diffing against HEAD keeps
// `npm run check` usable there. CI always passes --base explicitly, so a missing
// base in CI is still exit 2 rather than a silently empty diff.
if (!explicitBase && git(['rev-parse', '--verify', '--quiet', base]) === null) {
  console.log('check-constraints: origin/main not found, diffing the working tree against HEAD');
  base = 'HEAD';
}

const mergeBase = git(['merge-base', base, 'HEAD'])?.trim();
if (!mergeBase) {
  bail(`no merge base against ${base} (shallow clone?) — fetch history and retry`);
}

const tracked = git(['diff', '--unified=0', mergeBase, '--']);
if (tracked === null) bail('could not diff against ' + mergeBase);

const untrackedList = git(['ls-files', '--others', '--exclude-standard']);
if (untrackedList === null) bail('could not list untracked files');
const untracked = untrackedList
  .split('\n')
  .filter(Boolean)
  .map((file) => {
    const patch = git(['diff', '--no-index', '--unified=0', '/dev/null', file], {
      diffExit: true,
    });
    if (patch === null) bail('could not read untracked file ' + file);
    return patch;
  })
  .join('\n');

const diff = tracked + '\n' + untracked;

// Read the diff. `---`/`+++` are headers only between a file's `diff` line and its
// first hunk; inside a hunk every line is content, so an added `++i` is a change.
const added = [];
const removed = [];
const deleted = [];
const pathOf = (line) => line.replace(/^[ab]\//, '');
let file = '';
let oldFile = '';
let inHeader = false;

for (const line of diff.split('\n')) {
  if (line.startsWith('diff ')) {
    inHeader = true;
  } else if (line.startsWith('@@')) {
    inHeader = false;
  } else if (inHeader) {
    if (line.startsWith('--- ')) {
      oldFile = pathOf(line.slice(4));
    } else if (line.startsWith('+++ ')) {
      const newFile = pathOf(line.slice(4));
      file = newFile === '/dev/null' ? oldFile : newFile;
      if (newFile === '/dev/null') deleted.push(file);
    }
  } else if (line.startsWith('+')) {
    added.push({ file, text: line.slice(1) });
  } else if (line.startsWith('-')) {
    removed.push({ file, text: line.slice(1) });
  }
}

const findings = [];
const flag = (rule, target, text) =>
  findings.push({ rule, file: target, text: text.trim().slice(0, 120) });

const isTest = (path) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || /(^|\/)test_/.test(path);
const isConstraints = (path) => /(^|\/)CONSTRAINTS\.md$/.test(path);
// Prose and this guard's own source contain the patterns as examples and regexes.
// Suppressions only matter in code, so those files are exempt from text checks.
const isProse = (path) =>
  /\.md$/i.test(path) || /^scripts\/check-constraints\.(mjs|test\.mjs)$/.test(path);
const isGateFile = (path) => /\.(ya?ml|json)$/.test(path);

const SUPPRESSIONS =
  /@ts-ignore|@ts-nocheck|eslint-disable|biome-ignore|istanbul ignore|nosemgrep|gitleaks:allow|Stryker disable/;
const STUBS =
  /throw new (Error|NotImplemented).*[Nn]ot implemented|catch\s*\(\w*\)\s*\{\s*\}|catch\s*\{\s*\}|\bTODO\b/;
const SKIPS = /\.(skip|todo)\s*\(|\bxit\(|\bxdescribe\(|@pytest\.mark\.skip|t\.Skip\(/;
const DISABLED_GATE = /continue-on-error\s*:\s*true|--passWithNoTests|--no-verify|\|\|\s*true\b/;

for (const { file: target, text } of added) {
  if (!isProse(target)) {
    if (SUPPRESSIONS.test(text)) flag('silenced-checker', target, text);
    if (STUBS.test(text)) flag('unfinished-work', target, text);
    if (SKIPS.test(text)) flag('test-made-easier', target, text);
  }
  if (isGateFile(target) && !isProse(target) && DISABLED_GATE.test(text)) {
    flag('disabled-gate', target, text);
  }
  if (isConstraints(target) && /^\|\s*(W|E)\d+\s*\|/.test(text.trim())) {
    flag('new-exception', target, text);
  }
}

for (const target of deleted) {
  if (isTest(target)) flag('test-deleted', target, 'file deleted');
}
for (const { file: target, text } of removed) {
  if (isTest(target) && !deleted.includes(target) && /\b(expect|assert)\s*\(/.test(text)) {
    flag('assertion-removed', target, text);
  }
}

// A rule in CONSTRAINTS.md is a floor bullet or a table row, keyed by the text
// before its first colon or by the row's first cell. A row's thresholds are the
// numbers in its value column — `Rule` in the floor table, `Today` in the measured
// one — not the tool names, versions and checkpoint ids in the cells beside it.
const rowCells = (text) => text.trim().split('|').map((cell) => cell.trim());

const ruleKey = (text) => {
  const line = text.trim();
  if (line.startsWith('|')) return rowCells(line).filter(Boolean)[0] ?? '';
  if (/^[-*] /.test(line)) return line.slice(2).split(':')[0].trim();
  return null;
};
const isExceptionRow = (text) => /^\|\s*(W|E)\d+\s*\|/.test(text.trim());

// Direction is read from the whole row, so `must not fall` written in a Direction
// column governs a number two cells away. A row that says nothing is checked for
// words beside each number instead. A minimum loosens by going down, a maximum by
// going up, and a number whose direction cannot be read is reported when it moves.
const MIN_WORDS =
  /(>=|≥|\bat least\b|\bminimum\b|\bmin\b|no less than|must not fall|must not drop|or more|or higher)/i;
const MAX_WORDS =
  /(<=|≤|\bat most\b|\bmaximum\b|\bmax\b|no more than|\bunder\b|\bbelow\b|must not grow|must not exceed|or less|or lower)/i;
const MIN_BEFORE = /(>=|≥|at least|minimum|\bmin\b|no less than|must not fall|must not drop)\s*$/i;
const MAX_BEFORE = /(<=|≤|at most|maximum|\bmax\b|no more than|under|below|must not grow|must not exceed)\s*$/i;
const MIN_AFTER = /^\s*\S*\s*(or more|or higher|must not fall|must not drop)/i;
const MAX_AFTER = /^\s*\S*\s*(or less|or lower|must not grow|must not exceed)/i;

const rowDirection = (text) => {
  const minimum = MIN_WORDS.test(text);
  const maximum = MAX_WORDS.test(text);
  return minimum && !maximum ? 'min' : maximum && !minimum ? 'max' : null;
};

const thresholdText = (text) => {
  const line = text.trim();
  if (!line.startsWith('|')) return line;
  return rowCells(line).filter(Boolean)[1] ?? '';
};

const thresholds = (text) => {
  const cell = thresholdText(text);
  const directionOfRow = rowDirection(text);
  const out = [];
  const pattern = /\d+(?:\.\d+)?/g;
  let match;
  while ((match = pattern.exec(cell))) {
    const before = cell.slice(Math.max(0, match.index - 24), match.index);
    const after = cell.slice(match.index + match[0].length, match.index + match[0].length + 40);
    const direction =
      directionOfRow ??
      (MIN_BEFORE.test(before) || MIN_AFTER.test(after)
        ? 'min'
        : MAX_BEFORE.test(before) || MAX_AFTER.test(after)
          ? 'max'
          : null);
    out.push({ value: Number(match[0]), direction });
  }
  return out;
};

const removedRules = removed.filter((line) => isConstraints(line.file) && ruleKey(line.text) !== null);
const addedRules = added.filter((line) => isConstraints(line.file) && ruleKey(line.text) !== null);

// Two rows can share a label — `Tests` appears in the floor table and again in the
// measured one — so pair them by order of appearance within the diff rather than by
// first match, which would compare a measured row against the floor row.
const addedByKey = new Map();
for (const line of addedRules) {
  const key = ruleKey(line.text);
  addedByKey.set(key, [...(addedByKey.get(key) ?? []), line]);
}
const seenByKey = new Map();

for (const rule of removedRules) {
  const key = ruleKey(rule.text);
  const occurrence = seenByKey.get(key) ?? 0;
  seenByKey.set(key, occurrence + 1);
  const replacement = addedByKey.get(key)?.[occurrence];
  if (!replacement) {
    // Dropping an exception tightens the bar, so it stays silent.
    if (!isExceptionRow(rule.text)) flag('rule-removed', rule.file, rule.text);
    continue;
  }

  const before = thresholds(rule.text);
  const after = thresholds(replacement.text);
  let verdict = null;

  for (let index = 0; index < Math.max(before.length, after.length) && !verdict; index += 1) {
    const was = before[index];
    const now = after[index];
    if (!now) {
      // A number that never carried a direction was not a readable threshold, so a
      // rewrite that drops it is not a removal. One that did carry a direction is.
      if (was.direction) verdict = 'threshold-removed';
      continue;
    }
    if (!was) continue; // adding a threshold tightens the bar.
    if (now.value === was.value) continue;
    if (now.direction === null) {
      // The new line lost its direction words, so a fall can still be read as a
      // fall; anything else needs a human.
      verdict =
        was.direction === 'min' && now.value < was.value ? 'threshold-loosened' : 'threshold-changed';
    } else if (was.direction !== null && was.direction !== now.direction) {
      verdict = 'threshold-changed';
    } else if (now.direction === 'min' ? now.value < was.value : now.value > was.value) {
      verdict = 'threshold-loosened';
    }
  }

  if (verdict) flag(verdict, rule.file, `${rule.text}  ->  ${replacement.text}`);
}

if (findings.length === 0) {
  console.log('check-constraints: clean');
  process.exit(0);
}

console.error(`check-constraints: ${findings.length} move(s) that lower the bar:`);
for (const finding of findings) {
  console.error(`  [${finding.rule}] ${finding.file}: ${finding.text}`);
}
if (findings.some((finding) => finding.rule === 'rule-removed')) {
  console.error(
    '\nA removed rule can also mean its label changed: rename a rule and change its threshold in separate commits.',
  );
}
if (findings.some((finding) => finding.rule === 'threshold-removed')) {
  console.error(
    '\nA removed threshold can also mean a number lost its direction words; compare both lines before assuming deletion.',
  );
}
console.error('\nFix the code, or record a tracked exception in CONSTRAINTS.md. Do not edit this guard to pass.');
process.exit(1);
