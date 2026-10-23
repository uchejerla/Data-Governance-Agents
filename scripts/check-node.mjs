// Fails fast on a Node older than the floor the suite actually needs.
//
// Without this, `npm test` on Node 22.13 exits non-zero with every assertion
// passing: the jsdom worker never starts, because undici's decompressor binds
// `zlib.createZstdDecompress`, which arrived in 22.15. The report then reads as
// a crash in the code rather than a machine below the floor.
//
// The floor is the locked jsdom 30 requirement; undici 8 needs 22.19.

import { pathToFileURL } from 'node:url';

/** The oldest Node this repository supports, matching `engines` and `.nvmrc`. */
export const FLOOR = '22.22.0';

function segments(version) {
  return String(version)
    .trim()
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10));
}

/**
 * True when `version` is older than `floor`.
 *
 * Compares number by number: a string comparison calls 22.9 newer than 22.22,
 * which is the mistake this guard exists to avoid making in the other direction.
 */
export function isBelowFloor(version, floor = FLOOR) {
  const current = segments(version);
  const required = segments(floor);
  for (let index = 0; index < 3; index += 1) {
    const left = current[index] ?? 0;
    const right = required[index] ?? 0;
    // An unreadable version is not evidence of an old one; say so instead of
    // blocking a machine that may well be fine.
    if (!Number.isFinite(left)) return false;
    if (left !== right) return left < right;
  }
  return false;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const current = process.versions.node;
  if (isBelowFloor(current)) {
    console.error('');
    console.error(`Node ${current} is below the supported floor ${FLOOR}.`);
    console.error(
      'The DOM suite cannot start here: jsdom 30 needs 22.22 (undici 8 needs 22.19),',
    );
    console.error('and it fails inside undici rather than in a test, so it reads as a code bug.');
    console.error('Switch with `nvm use` — installing 22.22.0 first if it is not there (.nvmrc).');
    console.error('');
    process.exit(1);
  }
}
