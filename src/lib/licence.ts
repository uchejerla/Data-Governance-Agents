import { useSyncExternalStore } from 'react';

// Client half of licensing: one fetch of the installation's entitlement, then a
// shared store the shell, navigation and decision controls read from. The server
// enforces expiry and package gates; this only decides what to show and whether a
// control can be offered, so the UI never claims a permission the API would refuse.

export type LicenceStatus = 'active' | 'expired' | 'not-yet-valid' | 'invalid' | 'unlicensed';
export type LicenceSource = 'licence' | 'evaluation' | 'none';

export type LicenceModule =
  | 'catalog-curation'
  | 'quality-triage'
  | 'policy-qa'
  | 'access-review'
  | 'stewardship-planner'
  | 'audit-export'
  | 'sso';

/** Mirrors `LicenceSummary` in worker/licence.ts — the shape of `GET /api/licence`. */
export interface LicenceSummary {
  status: LicenceStatus;
  source: LicenceSource;
  readOnly: boolean;
  packages: string[];
  modules: LicenceModule[];
  /** 0 means "not limited" — evaluation mode only. */
  seats: number;
  workspaces: number;
  notAfter: string | null;
  daysRemaining: number | null;
  reason: string | null;
}

export interface LicenceState {
  status: 'loading' | 'ready' | 'error';
  licence: LicenceSummary | null;
  error: string | null;
}

let state: LicenceState = { status: 'loading', licence: null, error: null };
const listeners = new Set<() => void>();

function emit(patch: Partial<LicenceState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function getLicenceState(): LicenceState {
  return state;
}

export function subscribeLicence(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLicence(): LicenceState {
  return useSyncExternalStore(subscribeLicence, getLicenceState, getLicenceState);
}

export async function refreshLicence(): Promise<void> {
  try {
    const response = await fetch('/api/licence', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      emit({ status: 'error', licence: null, error: `Licence check failed (${response.status})` });
      return;
    }
    const body = (await response.json()) as { licence?: LicenceSummary | null };
    emit({ status: 'ready', licence: body.licence ?? null, error: null });
  } catch {
    emit({ status: 'error', licence: null, error: 'Could not read the licence' });
  }
}

let started = false;

export function startLicenceSync(): void {
  if (started) return;
  started = true;
  void refreshLicence();
}

/**
 * Unknown licence state (still loading, or the endpoint failed) must not hide the
 * product: only a loaded entitlement is allowed to withdraw a module.
 */
export function isModuleLicensed(
  licence: LicenceSummary | null,
  module: LicenceModule,
): boolean {
  if (!licence) return true;
  return licence.modules.includes(module);
}

export function seatLabel(licence: LicenceSummary | null): string {
  if (!licence) return '—';
  if (licence.seats === 0) return 'Unlimited';
  return `${licence.seats} seat${licence.seats === 1 ? '' : 's'}`;
}
