#!/usr/bin/env node
// Issue signed licence tokens for self-hosted installations.
//
//   node scripts/issue-licence.mjs --generate [--kid 2026-01]
//       Creates a P-256 keypair. Keep the private key offline; the public key goes
//       into the installation's LICENCE_PUBLIC_KEY.
//
//   node scripts/issue-licence.mjs --claims claims.json --key signing-key.json
//       Prints the compact JWS token to stdout, ready for LICENCE_KEY.
//
// The signing key never leaves this machine and is never committed. Verification
// happens in the installation with the public half only.

import { readFile } from 'node:fs/promises';

const PACKAGES = ['essential', 'professional', 'enterprise'];
const REQUIRED_STRINGS = ['lic', 'customer', 'issued_at', 'not_after'];

const args = process.argv.slice(2);

function arg(name, fallback = undefined) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function segment(value) {
  return toBase64Url(Buffer.from(JSON.stringify(value), 'utf8'));
}

function usage() {
  console.error(`Usage:
  node scripts/issue-licence.mjs --generate [--kid 2026-01]
  node scripts/issue-licence.mjs --claims claims.json --key signing-key.json

A claims file looks like:
{
  "v": 1,
  "lic": "LIC-2026-0007",
  "customer": "Northwind Insurance",
  "packages": ["professional"],
  "seats": 15,
  "workspaces": 3,
  "issued_at": "2026-10-23T00:00:00.000Z",
  "not_after": "2027-10-22T23:59:59.000Z",
  "support": "business"
}`);
}

function validate(claims) {
  const errors = [];
  if (claims.v !== 1) errors.push('v must be 1');
  for (const field of REQUIRED_STRINGS) {
    if (typeof claims[field] !== 'string' || claims[field].trim().length === 0) {
      errors.push(`${field} is required`);
    }
  }
  if (
    !Array.isArray(claims.packages) ||
    claims.packages.length === 0 ||
    !claims.packages.every((id) => PACKAGES.includes(id))
  ) {
    errors.push(`packages must be one or more of: ${PACKAGES.join(', ')}`);
  }
  if (!Number.isInteger(claims.seats) || claims.seats < 1) {
    errors.push('seats must be an integer of at least 1');
  }
  if (!Number.isInteger(claims.workspaces) || claims.workspaces < 1) {
    errors.push('workspaces must be an integer of at least 1');
  }
  if (Number.isNaN(Date.parse(claims.issued_at)) || Number.isNaN(Date.parse(claims.not_after))) {
    errors.push('issued_at and not_after must be ISO dates');
  } else if (Date.parse(claims.not_after) <= Date.parse(claims.issued_at)) {
    errors.push('not_after must be after issued_at');
  }
  if (
    claims.addons !== undefined &&
    (!Array.isArray(claims.addons) || claims.addons.some((id) => typeof id !== 'string'))
  ) {
    errors.push('addons must be an array of module ids');
  }
  return errors;
}

async function generate() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const publicKey = toBase64Url(await crypto.subtle.exportKey('spki', pair.publicKey));
  const privateKey = toBase64Url(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  console.log(
    JSON.stringify({ kid: arg('kid', '2026-01'), publicKey, privateKey }, null, 2),
  );
  console.error(
    'Store the private key offline (never in the repository).\n' +
      'Give the public key to installations as LICENCE_PUBLIC_KEY.',
  );
}

async function issue() {
  const claimsPath = arg('claims');
  const keyPath = arg('key');
  if (!claimsPath || !keyPath) {
    usage();
    process.exit(1);
  }

  const claims = JSON.parse(await readFile(claimsPath, 'utf8'));
  const errors = validate(claims);
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exit(1);
  }

  const key = JSON.parse(await readFile(keyPath, 'utf8'));
  if (typeof key.privateKey !== 'string') {
    console.error('Signing key file needs a privateKey field (base64url PKCS#8).');
    process.exit(1);
  }

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    fromBase64Url(key.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const header = segment({ alg: 'ES256', typ: 'licence+jws', kid: key.kid ?? arg('kid', '2026-01') });
  const payload = segment(claims);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    Buffer.from(`${header}.${payload}`, 'utf8'),
  );

  process.stdout.write(`${header}.${payload}.${toBase64Url(signature)}\n`);
}

if (args.includes('--generate')) {
  await generate();
} else if (args.includes('--claims')) {
  await issue();
} else {
  usage();
  process.exit(1);
}
