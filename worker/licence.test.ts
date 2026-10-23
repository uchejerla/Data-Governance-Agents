import { describe, expect, it } from 'vitest';
import {
  ALL_MODULES,
  PACKAGES,
  canAddMember,
  evaluateLicence,
  hasModule,
  summarise,
  type LicenceClaims,
} from './licence';

// The tests sign real ES256 tokens with a throwaway keypair, so verification is
// exercised through the same WebCrypto path the Worker uses at runtime.

const NOW = new Date('2026-10-23T12:00:00.000Z');

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function segment(value: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function makeKeyPair() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const spki = (await crypto.subtle.exportKey('spki', pair.publicKey)) as ArrayBuffer;
  return { privateKey: pair.privateKey, publicKey: toBase64Url(new Uint8Array(spki)) };
}

async function sign(
  claims: LicenceClaims,
  privateKey: CryptoKey,
  kid = 'test-2026-01',
): Promise<string> {
  const header = segment({ alg: 'ES256', typ: 'licence+jws', kid });
  const payload = segment(claims);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

function claims(overrides: Partial<LicenceClaims> = {}): LicenceClaims {
  return {
    v: 1,
    lic: 'LIC-2026-0001',
    customer: 'Northwind Insurance',
    packages: ['professional'],
    seats: 15,
    workspaces: 3,
    issued_at: '2026-10-01T00:00:00.000Z',
    not_after: '2027-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('licence verification', () => {
  it('accepts a licence signed by the configured key and derives its packages', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const token = await sign(claims(), privateKey);

    const entitlement = await evaluateLicence({
      token,
      publicKey,
      keyId: 'test-2026-01',
      now: NOW,
    });

    expect(entitlement).toMatchObject({
      status: 'active',
      source: 'licence',
      readOnly: false,
      packages: ['professional'],
      seats: 15,
      workspaces: 3,
      licenceId: 'LIC-2026-0001',
      customer: 'Northwind Insurance',
      notAfter: '2027-10-01T00:00:00.000Z',
    });
    expect(entitlement.daysRemaining).toBe(343);
    expect(hasModule(entitlement, 'catalog-curation')).toBe(true);
    expect(hasModule(entitlement, 'audit-export')).toBe(true);
    // The planner and SSO are enterprise-only.
    expect(hasModule(entitlement, 'stewardship-planner')).toBe(false);
    expect(hasModule(entitlement, 'sso')).toBe(false);
  });

  it('adds negotiated add-ons on top of a package', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const token = await sign(claims({ packages: ['essential'], addons: ['sso'] }), privateKey);

    const entitlement = await evaluateLicence({ token, publicKey, now: NOW });

    expect(entitlement.modules).toEqual(
      expect.arrayContaining(['catalog-curation', 'policy-qa', 'sso']),
    );
    expect(hasModule(entitlement, 'stewardship-planner')).toBe(false);
  });

  it('fails closed when the payload is altered after signing', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const token = await sign(claims({ seats: 15 }), privateKey);
    const [header, payload, signature] = token.split('.');
    const tampered = {
      ...JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))),
      seats: 1000,
      packages: ['enterprise'],
    };

    const entitlement = await evaluateLicence({
      token: `${header}.${segment(tampered)}.${signature}`,
      publicKey,
      now: NOW,
    });

    expect(entitlement.status).toBe('invalid');
    expect(entitlement.readOnly).toBe(true);
    expect(entitlement.modules).toEqual([]);
    expect(entitlement.seats).toBe(0);
    expect(entitlement.reason).toContain('signature');
  });

  it('rejects a licence signed by a different key', async () => {
    const signer = await makeKeyPair();
    const other = await makeKeyPair();
    const token = await sign(claims(), signer.privateKey);

    const entitlement = await evaluateLicence({ token, publicKey: other.publicKey, now: NOW });

    expect(entitlement.status).toBe('invalid');
    expect(entitlement.readOnly).toBe(true);
  });

  it('rejects a key id the installation does not hold', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const token = await sign(claims(), privateKey, 'old-key');

    const entitlement = await evaluateLicence({
      token,
      publicKey,
      keyId: 'test-2026-01',
      now: NOW,
    });

    expect(entitlement.status).toBe('invalid');
    expect(entitlement.reason).toContain('different key');
  });

  it('rejects unsigned and malformed tokens', async () => {
    const header = segment({ alg: 'none', typ: 'licence+jws' });
    const payload = segment(claims());

    for (const token of [`${header}.${payload}.`, 'not-a-token', `${header}.${payload}.AAAA`]) {
      const entitlement = await evaluateLicence({ token, publicKey: 'AAAA', now: NOW });
      expect(entitlement.readOnly).toBe(true);
      expect(entitlement.status).toBe('invalid');
    }
  });

  it('rejects claims it cannot honour', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const cases: Partial<LicenceClaims>[] = [
      { packages: ['platinum' as never] },
      { seats: 0 },
      { workspaces: -1 },
      { not_after: '2026-09-01T00:00:00.000Z', issued_at: '2026-10-01T00:00:00.000Z' },
      { lic: '' },
    ];

    for (const override of cases) {
      const token = await sign(claims(override), privateKey);
      const entitlement = await evaluateLicence({ token, publicKey, now: NOW });
      expect(entitlement.status, JSON.stringify(override)).toBe('invalid');
      expect(entitlement.readOnly).toBe(true);
    }
  });
});

describe('licence expiry', () => {
  it('goes read-only after the expiry date but keeps the module list', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const token = await sign(claims({ not_after: '2026-10-20T00:00:00.000Z' }), privateKey);

    const entitlement = await evaluateLicence({ token, publicKey, now: NOW });

    expect(entitlement.status).toBe('expired');
    expect(entitlement.readOnly).toBe(true);
    expect(entitlement.daysRemaining).toBe(0);
    expect(entitlement.reason).toContain('expired on 20 Oct 2026');
    expect(hasModule(entitlement, 'audit-export')).toBe(true);
    expect(canAddMember(entitlement, 0)).toBe(false);
  });

  it('treats the exact expiry instant as expired', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const token = await sign(claims({ not_after: '2026-10-23T12:00:00.000Z' }), privateKey);

    const entitlement = await evaluateLicence({ token, publicKey, now: NOW });

    expect(entitlement.status).toBe('expired');
    expect(entitlement.readOnly).toBe(true);
  });

  it('refuses a licence that has not started yet', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const token = await sign(
      claims({ not_before: '2026-11-01T00:00:00.000Z', not_after: '2027-11-01T00:00:00.000Z' }),
      privateKey,
    );

    const entitlement = await evaluateLicence({ token, publicKey, now: NOW });

    expect(entitlement.status).toBe('not-yet-valid');
    expect(entitlement.readOnly).toBe(true);
    expect(entitlement.reason).toContain('1 Nov 2026');
  });
});

describe('unlicensed installs', () => {
  it('runs as an evaluation with every module while no licence is configured', async () => {
    const entitlement = await evaluateLicence({ now: NOW });

    expect(entitlement).toMatchObject({
      status: 'unlicensed',
      source: 'evaluation',
      readOnly: false,
      seats: 0,
      workspaces: 0,
      notAfter: null,
    });
    expect(entitlement.modules).toEqual(ALL_MODULES);
    expect(entitlement.reason).toContain('Evaluation mode');
    expect(canAddMember(entitlement, 999)).toBe(true);
  });

  it('is read-only when the operator requires a licence', async () => {
    const entitlement = await evaluateLicence({ required: true, now: NOW });

    expect(entitlement.status).toBe('unlicensed');
    expect(entitlement.readOnly).toBe(true);
    expect(entitlement.modules).toEqual([]);
    expect(canAddMember(entitlement, 0)).toBe(false);
  });

  it('is read-only when a licence exists but no public key can verify it', async () => {
    const entitlement = await evaluateLicence({ token: 'a.b.c', now: NOW });

    expect(entitlement.status).toBe('invalid');
    expect(entitlement.readOnly).toBe(true);
    expect(entitlement.reason).toContain('no signing key');
  });
});

describe('seats and packages', () => {
  it('counts seats against the licensed maximum', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const token = await sign(claims({ seats: 3 }), privateKey);
    const entitlement = await evaluateLicence({ token, publicKey, now: NOW });

    expect(canAddMember(entitlement, 0)).toBe(true);
    expect(canAddMember(entitlement, 2)).toBe(true);
    expect(canAddMember(entitlement, 3)).toBe(false);
  });

  it('keeps the tiers nested, so an upgrade never removes a module', () => {
    const essential = new Set(PACKAGES.essential.modules);
    const professional = new Set(PACKAGES.professional.modules);
    const enterprise = new Set(PACKAGES.enterprise.modules);

    for (const module of essential) expect(professional.has(module)).toBe(true);
    for (const module of professional) expect(enterprise.has(module)).toBe(true);
    expect(professional.has('stewardship-planner')).toBe(false);
    expect(professional.has('sso')).toBe(false);
    expect(enterprise.size).toBe(ALL_MODULES.length);
  });

  it('publishes a summary without the customer or licence id', async () => {
    const { privateKey, publicKey } = await makeKeyPair();
    const token = await sign(claims(), privateKey);
    const entitlement = await evaluateLicence({ token, publicKey, now: NOW });

    const summary = summarise(entitlement);

    expect(summary).toMatchObject({
      status: 'active',
      readOnly: false,
      packages: ['professional'],
      seats: 15,
      workspaces: 3,
      notAfter: '2027-10-01T00:00:00.000Z',
    });
    expect(summary).not.toHaveProperty('customer');
    expect(summary).not.toHaveProperty('licenceId');
  });
});
