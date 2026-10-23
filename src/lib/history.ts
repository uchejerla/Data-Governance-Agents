import type { DecisionEvent } from './decisions';
import { recKey } from './decisions';
import { glossaryIssues, reviewCatalogAsset } from './catalog';
import type { Domain, DomainId, GovernanceSnapshot, Person } from '../types';

// The audit log stores recommendation keys, not prose. This module turns those
// keys back into the item a steward recognises, and groups the flat event stream
// into one timeline per recommendation, so the history view reads like a record
// of decisions rather than a table of ids.

export type RecSource = 'Catalog' | 'Quality' | 'Access' | 'Glossary' | 'Attestation';

export interface RecommendationRef {
  key: string;
  title: string;
  detail: string;
  source: RecSource;
  domainId?: DomainId;
}

export interface HistoryGroup {
  key: string;
  /** Absent when the key names an item that is no longer in the snapshot. */
  ref?: RecommendationRef;
  /** Newest first. */
  events: DecisionEvent[];
  lastAt: string;
}

/**
 * Every recommendation the app can record a decision about, by key. Built from
 * the same helpers the assistants and the planner use, so a key in the log and a
 * row on screen resolve to the same wording.
 */
export function recommendationIndex(snapshot: GovernanceSnapshot): Map<string, RecommendationRef> {
  const index = new Map<string, RecommendationRef>();
  const add = (ref: RecommendationRef) => {
    if (!index.has(ref.key)) index.set(ref.key, ref);
  };

  for (const asset of snapshot.assets) {
    const review = reviewCatalogAsset(asset.id, snapshot);
    for (const gap of review.gaps) {
      add({
        key: recKey.catalogGap(asset.id, gap.id),
        title: gap.label,
        detail: asset.name,
        source: 'Catalog',
        domainId: asset.domainId,
      });
    }
  }

  for (const rule of snapshot.rules) {
    const asset = snapshot.assets.find((a) => a.id === rule.assetId);
    add({
      key: recKey.rule(rule.id),
      title: `Remediate ${rule.name.toLowerCase()}`,
      detail: asset?.name ?? rule.assetId,
      source: 'Quality',
      domainId: asset?.domainId,
    });
  }

  for (const request of snapshot.pendingAccessRequests) {
    const asset = snapshot.assets.find((a) => a.id === request.assetId);
    add({
      key: recKey.accessRequest(request.id),
      title: `Clear access request ${request.id}`,
      detail: asset?.name ?? request.assetId,
      source: 'Access',
      domainId: asset?.domainId,
    });
  }

  for (const issue of glossaryIssues(snapshot)) {
    const termIds = Array.from(issue.terms.join(' ').matchAll(/G-\d+/g)).map((match) => match[0]);
    const term = snapshot.terms.find((t) => termIds.includes(t.id));
    add({
      key: recKey.glossaryIssue(issue.id),
      title: issue.action,
      detail: issue.terms.join(' vs '),
      source: 'Glossary',
      domainId: term?.domainId,
    });
  }

  for (const attestation of snapshot.attestations) {
    const person = snapshot.people.find((p) => p.id === attestation.personId);
    add({
      key: recKey.attestation(attestation.personId, attestation.policyCode),
      title: `Chase policy attestation — ${attestation.policyCode}`,
      detail: person?.name ?? attestation.personId,
      source: 'Attestation',
      domainId: person && person.domainId !== 'platform' && person.domainId !== 'risk' ? person.domainId : undefined,
    });
  }

  return index;
}

/** One group per recommendation key, most recently touched first. */
export function groupEvents(
  events: DecisionEvent[],
  index: Map<string, RecommendationRef>,
): HistoryGroup[] {
  const groups = new Map<string, HistoryGroup>();
  for (const event of events) {
    const group = groups.get(event.key) ?? {
      key: event.key,
      ref: index.get(event.key),
      events: [],
      lastAt: event.at,
    };
    group.events.push(event);
    if (Date.parse(event.at) > Date.parse(group.lastAt)) group.lastAt = event.at;
    groups.set(event.key, group);
  }

  for (const group of groups.values()) {
    group.events.sort((a, b) => b.id - a.id);
  }

  return Array.from(groups.values()).sort(
    (a, b) => b.events[0].id - a.events[0].id,
  );
}

export interface HistoryActor {
  id: string;
  name: string;
  count: number;
}

/** The stewards who appear in the log, busiest first. */
export function historyActors(events: DecisionEvent[]): HistoryActor[] {
  const actors = new Map<string, HistoryActor>();
  for (const event of events) {
    const actor = actors.get(event.actorId) ?? {
      id: event.actorId,
      name: event.actorName ?? 'Unknown steward',
      count: 0,
    };
    actor.count += 1;
    actors.set(event.actorId, actor);
  }
  return Array.from(actors.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function eventLabel(event: DecisionEvent, assigneeName?: string): string {
  if (event.action === 'cleared') return 'Withdrew the decision';
  const verb = event.action === 'accepted' ? 'Accepted' : 'Dismissed';
  if (event.action === 'dismissed') return verb;
  return assigneeName ? `${verb} and assigned to ${assigneeName}` : verb;
}

const CSV_VERB: Record<DecisionEvent['action'], string> = {
  accepted: 'Accepted',
  dismissed: 'Dismissed',
  cleared: 'Withdrew',
};

/**
 * The audit trail as a table a review pack can carry: one row per change, with
 * the item named in the same words the stewards saw and the actor resolved to a
 * person. Withdrawn rows keep an empty assignee, because their assignment went
 * with the decision.
 */
export function historyCsvRows(
  groups: HistoryGroup[],
  context: { people: Map<string, Person>; domains: Map<string, Domain> },
): string[][] {
  const rows: string[][] = [
    ['Item key', 'Item', 'Detail', 'Source', 'Domain', 'Activity', 'Steward', 'Assignee', 'Recorded at (UTC)'],
  ];

  for (const group of groups) {
    for (const event of group.events) {
      const domain = group.ref?.domainId ? context.domains.get(group.ref.domainId) : undefined;
      rows.push([
        group.key,
        group.ref?.title ?? group.key,
        group.ref?.detail ?? '',
        group.ref?.source ?? '',
        domain?.name ?? '',
        CSV_VERB[event.action],
        event.actorName ?? '',
        event.assigneeId
          ? (context.people.get(event.assigneeId)?.name ?? event.assigneeId)
          : '',
        event.at,
      ]);
    }
  }

  return rows;
}

export function formatEventTime(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
