// Licensing core for self-hosted installs.
//
// A licence is a compact JWS (ES256) signed by the vendor. The installation holds
// only the public key, so it can verify a licence offline but can never mint one.
// This file has no runtime dependencies beyond WebCrypto — no D1, no Cloudflare
// bindings, no Node APIs — so it moves unchanged to the self-hosted Node server.
//
// Enforcement philosophy: expiry fails closed (read-only, reads still work),
// a missing licence is evaluation mode unless the operator demands one, and a
// licence that cannot be verified grants nothing. Self-hosted enforcement is a
// commercial control for the compliant case, not a defence against a customer who
// patches the binary; see docs/licensing.md.

const DAY_MS = 86_400_000;
const MAX_TOKEN_LENGTH = 8192;

export type ModuleId =
  | 'catalog-curation'
  | 'quality-triage'
  | 'policy-qa'
  | 'access-review'
  | 'stewardship-planner'
  | 'audit-export'
  | 'sso';

export type PackageId = 'essential' | 'professional' | 'enterprise';
export type SupportTier = 'community' | 'business' | 'enterprise';
export type LicenceStatus = 'active' | 'expired' | 'not-yet-valid' | 'invalid' | 'unlicensed';
export type LicenceSource = 'licence' | 'evaluation' | 'none';

export const ALL_MODULES: ModuleId[] = [
  'catalog-curation',
  'quality-triage',
  'policy-qa',
  'access-review',
  'stewardship-planner',
  'audit-export',
  'sso',
];

export interface PackageDefinition {
  name: string;
  summary: string;
  modules: ModuleId[];
  defaultSeats: number;
  defaultWorkspaces: number;
}

// Tiers are the commercial unit; modules are what the code checks. Seats and
// workspaces are negotiated per customer and carried in the token, so a deal can
// differ from the defaults without a new build.
export const PACKAGES: Record<PackageId, PackageDefinition> = {
  essential: {
    name: 'Essential',
    summary: 'Catalog curation and policy answers for one team.',
    modules: ['catalog-curation', 'policy-qa'],
    defaultSeats: 5,
    defaultWorkspaces: 1,
  },
  professional: {
    name: 'Professional',
    summary: 'Adds quality triage, access review and the audit trail with CSV export.',
    modules: ['catalog-curation', 'policy-qa', 'quality-triage', 'access-review', 'audit-export'],
    defaultSeats: 15,
    defaultWorkspaces: 3,
  },
  enterprise: {
    name: 'Enterprise',
    summary: 'Everything, including the stewardship planner and SSO.',
    modules: [...ALL_MODULES],
    defaultSeats: 50,
    defaultWorkspaces: 25,
  },
};

export const PACKAGE_IDS = Object.keys(PACKAGES) as PackageId[];

export interface LicenceClaims {
  /** Token format version. */
  v: 1;
  /** Licence identifier, quoted on the invoice and in support. */
  lic: string;
  customer: string;
  packages: PackageId[];
  /** Individual modules granted on top of the packages. */
  addons?: ModuleId[];
  seats: number;
  workspaces: number;
  issued_at: string;
  not_before?: string;
  not_after: string;
  support?: SupportTier;
  note?: string;
}

export interface Entitlement {
  status: LicenceStatus;
  source: LicenceSource;
  /** Writes are refused when true; reads and exports are not. */
  readOnly: boolean;
  modules: ModuleId[];
  packages: PackageId[];
  /** 0 means "not limited" — evaluation mode only. */
  seats: number;
  workspaces: number;
  licenceId: string | null;
  customer: string | null;
  notAfter: string | null;
  daysRemaining: number | null;
  /** Human-readable explanation, safe to show to a steward. */
  reason: string | null;
}

/** The subset the browser is allowed to see. Customer and licence id stay on the server. */
export interface LicenceSummary {
  status: LicenceStatus;
  source: LicenceSource;
  readOnly: boolean;
  packages: PackageId[];
  modules: ModuleId[];
  seats: number;
  workspaces: number;
  notAfter: string | null;
  daysRemaining: number | null;
  reason: string | null;
}

type Verified = { ok: true; claims: LicenceClaims } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isModule(value: unknown): value is ModuleId {
  return typeof value === 'string' && (ALL_MODULES as string[]).includes(value);
}

function isPackage(value: unknown): value is PackageId {
  return typeof value === 'string' && (PACKAGE_IDS as string[]).includes(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && /^\d{4}-\d{2}-\d{2}/.test(value);
}

function isBoundedInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised.padEnd(normalised.length + ((4 - (normalised.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonSegment(segment: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment)));
  } catch {
    return null;
  }
}

function validateClaims(value: unknown): Verified {
  if (!isRecord(value)) return { ok: false, reason: 'Licence payload is not an object' };
  if (value.v !== 1) return { ok: false, reason: 'Unsupported licence version' };

  const { lic, customer, packages, addons, seats, workspaces, issued_at, not_before, not_after } = value;

  if (typeof lic !== 'string' || lic.trim().length === 0 || lic.length > 120) {
    return { ok: false, reason: 'Licence has no identifier' };
  }
  if (typeof customer !== 'string' || customer.trim().length === 0 || customer.length > 200) {
    return { ok: false, reason: 'Licence names no customer' };
  }
  if (!Array.isArray(packages) || packages.length === 0 || !packages.every(isPackage)) {
    return { ok: false, reason: 'Licence names an unknown package' };
  }
  if (addons !== undefined && (!Array.isArray(addons) || !addons.every(isModule))) {
    return { ok: false, reason: 'Licence names an unknown add-on' };
  }
  if (!isBoundedInt(seats, 1, 100_000)) return { ok: false, reason: 'Licence seats are invalid' };
  if (!isBoundedInt(workspaces, 1, 10_000)) {
    return { ok: false, reason: 'Licence workspaces are invalid' };
  }
  if (!isIsoDate(issued_at)) return { ok: false, reason: 'Licence issue date is invalid' };
  if (!isIsoDate(not_after)) return { ok: false, reason: 'Licence expiry is invalid' };
  if (not_before !== undefined && !isIsoDate(not_before)) {
    return { ok: false, reason: 'Licence start date is invalid' };
  }
  if (Date.parse(not_after) <= Date.parse(issued_at)) {
    return { ok: false, reason: 'Licence expires before it was issued' };
  }

  return {
    ok: true,
    claims: {
      v: 1,
      lic,
      customer,
      packages: packages as PackageId[],
      ...(addons ? { addons: addons as ModuleId[] } : {}),
      seats,
      workspaces,
      issued_at,
      ...(not_before ? { not_before: not_before as string } : {}),
      not_after,
      ...(typeof value.support === 'string' &&
      ['community', 'business', 'enterprise'].includes(value.support)
        ? { support: value.support as SupportTier }
        : {}),
      ...(typeof value.note === 'string' ? { note: value.note.slice(0, 500) } : {}),
    },
  };
}

/**
 * Verify a compact JWS licence against an SPKI public key (base64 or base64url).
 * `keyId` is optional: set it when several signing keys are in circulation and a
 * licence must name the one that signed it.
 */
export async function verifyLicence(
  token: string,
  publicKey: string,
  keyId?: string | null,
): Promise<Verified> {
  const trimmed = token.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'Licence token is empty' };
  if (trimmed.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'Licence token is too long' };

  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return { ok: false, reason: 'Licence token is malformed' };
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts;

  const header = decodeJsonSegment(headerSegment);
  if (!isRecord(header)) return { ok: false, reason: 'Licence header is malformed' };
  if (header.alg !== 'ES256') return { ok: false, reason: 'Licence uses an unsupported algorithm' };
  if (keyId && header.kid !== keyId) {
    return { ok: false, reason: 'Licence was signed with a different key' };
  }

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'spki',
      decodeBase64Url(publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
  } catch {
    return { ok: false, reason: 'Licence public key is not a usable P-256 key' };
  }

  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      decodeBase64Url(signatureSegment),
      new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
    );
  } catch {
    return { ok: false, reason: 'Licence signature could not be verified' };
  }
  if (!valid) return { ok: false, reason: 'Licence signature does not match' };

  return validateClaims(decodeJsonSegment(payloadSegment));
}

export interface EvaluateOptions {
  token?: string | null;
  publicKey?: string | null;
  keyId?: string | null;
  /** When true, a missing or unreadable licence leaves the install read-only. */
  required?: boolean;
  now?: Date;
}

function evaluation(reason: string): Entitlement {
  return {
    status: 'unlicensed',
    source: 'evaluation',
    readOnly: false,
    modules: [...ALL_MODULES],
    packages: [],
    seats: 0,
    workspaces: 0,
    licenceId: null,
    customer: null,
    notAfter: null,
    daysRemaining: null,
    reason,
  };
}

function blocked(status: LicenceStatus, source: LicenceSource, reason: string, claims?: LicenceClaims, now?: Date): Entitlement {
  const modules = claims
    ? Array.from(new Set([...claims.packages.flatMap((id) => PACKAGES[id].modules), ...(claims.addons ?? [])]))
    : [];
  const notAfter = claims?.not_after ?? null;
  return {
    status,
    source,
    readOnly: true,
    modules,
    packages: claims?.packages ?? [],
    seats: claims?.seats ?? 0,
    workspaces: claims?.workspaces ?? 0,
    licenceId: claims?.lic ?? null,
    customer: claims?.customer ?? null,
    notAfter,
    daysRemaining: notAfter && now ? Math.max(0, Math.ceil((Date.parse(notAfter) - now.getTime()) / DAY_MS)) : null,
    reason,
  };
}

// Licence dates are UTC instants in the token. Formatting them in the server's
// local timezone would show an expiry a day early west of UTC, so the date the
// customer sees is always the date the token carries.
function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Turn configuration into the single entitlement the application consults. */
export async function evaluateLicence(options: EvaluateOptions = {}): Promise<Entitlement> {
  const now = options.now ?? new Date();
  const token = options.token?.trim();

  if (!token) {
    if (options.required) {
      return blocked(
        'unlicensed',
        'none',
        'No licence is configured on this installation, so it is read-only.',
      );
    }
    return evaluation(
      'Evaluation mode — no licence configured. Every module is enabled and writes are allowed.',
    );
  }

  if (!options.publicKey) {
    return blocked(
      'invalid',
      'none',
      'A licence is configured but no signing key is available to verify it, so the workspace is read-only.',
    );
  }

  const verified = await verifyLicence(token, options.publicKey, options.keyId);
  if (!verified.ok) {
    return blocked('invalid', 'licence', `Licence could not be verified: ${verified.reason}. The workspace is read-only.`);
  }

  const claims = verified.claims;
  const modules = Array.from(
    new Set([...claims.packages.flatMap((id) => PACKAGES[id].modules), ...(claims.addons ?? [])]),
  );

  const entitlement: Entitlement = {
    status: 'active',
    source: 'licence',
    readOnly: false,
    modules,
    packages: claims.packages,
    seats: claims.seats,
    workspaces: claims.workspaces,
    licenceId: claims.lic,
    customer: claims.customer,
    notAfter: claims.not_after,
    daysRemaining: Math.max(0, Math.ceil((Date.parse(claims.not_after) - now.getTime()) / DAY_MS)),
    reason: null,
  };

  if (claims.not_before && now.getTime() < Date.parse(claims.not_before)) {
    return blocked(
      'not-yet-valid',
      'licence',
      `Licence starts on ${formatDay(claims.not_before)}. The workspace is read-only until then.`,
      claims,
      now,
    );
  }

  if (now.getTime() >= Date.parse(claims.not_after)) {
    return blocked(
      'expired',
      'licence',
      `Licence expired on ${formatDay(claims.not_after)}. The workspace is read-only: decisions are refused until it is renewed, while reading and exporting stay available.`,
      claims,
      now,
    );
  }

  return entitlement;
}

export function hasModule(entitlement: Entitlement, module: ModuleId): boolean {
  return entitlement.modules.includes(module);
}

/** Evaluation mode has no seat limit (seats === 0). */
export function canAddMember(entitlement: Entitlement, currentMembers: number): boolean {
  if (entitlement.readOnly) return false;
  if (entitlement.seats === 0) return true;
  return currentMembers < entitlement.seats;
}

export function summarise(entitlement: Entitlement): LicenceSummary {
  return {
    status: entitlement.status,
    source: entitlement.source,
    readOnly: entitlement.readOnly,
    packages: entitlement.packages,
    modules: entitlement.modules,
    seats: entitlement.seats,
    workspaces: entitlement.workspaces,
    notAfter: entitlement.notAfter,
    daysRemaining: entitlement.daysRemaining,
    reason: entitlement.reason,
  };
}
