import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FLOOR, isBelowFloor } from './check-node.mjs';

// The guard only earns its place if it reads versions numerically and if the
// three places that state the floor agree. A drift between them is how a
// contributor ends up on a supported Node with an unsupported `.nvmrc`.

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, 'utf8');
const pkg = JSON.parse(read('package.json'));

describe('node floor', () => {
  it('blocks a version below the floor', () => {
    expect(isBelowFloor('22.13.0')).toBe(true);
    expect(isBelowFloor('22.21.9')).toBe(true);
    expect(isBelowFloor('21.7.0')).toBe(true);
    expect(isBelowFloor('20.19.4')).toBe(true);
  });

  it('allows the floor itself and anything newer', () => {
    expect(isBelowFloor(FLOOR)).toBe(false);
    expect(isBelowFloor('22.22.1')).toBe(false);
    expect(isBelowFloor('23.0.0')).toBe(false);
    expect(isBelowFloor('24.1.0')).toBe(false);
  });

  it('compares patch and minor numbers numerically, not as strings', () => {
    // "22.9" sorts above "22.22" as text but is the older release. Node never
    // shipped 22.9, which is exactly why this is easy to get wrong and cheap to
    // pin.
    expect(isBelowFloor('22.9.0')).toBe(true);
    expect(isBelowFloor('22.22.0', '22.9.0')).toBe(false);
  });

  it('reads a version with a leading v or a missing patch', () => {
    expect(isBelowFloor('v22.13.0')).toBe(true);
    expect(isBelowFloor('v22.22.0')).toBe(false);
    expect(isBelowFloor('22.13')).toBe(true);
  });

  it('keeps .nvmrc, engines and the guard on the same floor', () => {
    expect(read('.nvmrc').trim()).toBe(FLOOR);
    expect(pkg.engines.node).toBe(`>=${FLOOR}`);
  });

  it('runs the guard before the suite, so a low Node fails with a reason', () => {
    // Dropping the hook is a one-line edit that restores the undici crash.
    expect(pkg.scripts.pretest).toBe('node scripts/check-node.mjs');
  });
});
