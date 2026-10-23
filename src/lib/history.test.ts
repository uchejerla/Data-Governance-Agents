import { describe, expect, it } from 'vitest';
import { snapshot } from '../data/seed';
import { reviewCatalogAsset } from './catalog';
import type { DecisionEvent } from './decisions';
import { recKey } from './decisions';
import {
  eventLabel,
  groupEvents,
  historyActors,
  historyCsvRows,
  recommendationIndex,
} from './history';

function event(overrides: Partial<DecisionEvent> & Pick<DecisionEvent, 'id' | 'key'>): DecisionEvent {
  return {
    action: 'accepted',
    assigneeId: null,
    actorId: 'u-1',
    actorName: 'Priya Raman',
    at: '2026-10-20T09:00:00.000Z',
    ...overrides,
  };
}

describe('decision history', () => {
  it('resolves a recommendation key back to the wording a steward sees', () => {
    const asset = snapshot.assets.find((a) => reviewCatalogAsset(a.id, snapshot).gaps.length > 0);
    expect(asset).toBeTruthy();
    const gap = reviewCatalogAsset(asset!.id, snapshot).gaps[0];
    const index = recommendationIndex(snapshot);

    const ref = index.get(recKey.catalogGap(asset!.id, gap.id));
    expect(ref).toMatchObject({
      title: gap.label,
      detail: asset!.name,
      source: 'Catalog',
      domainId: asset!.domainId,
    });
  });

  it('indexes rules, access requests and glossary issues under the same keys the assistants write', () => {
    const index = recommendationIndex(snapshot);
    const rule = snapshot.rules[0];
    const request = snapshot.pendingAccessRequests[0];

    expect(index.get(recKey.rule(rule.id))).toMatchObject({
      title: `Remediate ${rule.name.toLowerCase()}`,
      source: 'Quality',
    });
    expect(index.get(recKey.accessRequest(request.id))).toMatchObject({
      title: `Clear access request ${request.id}`,
      source: 'Access',
    });
    expect(Array.from(index.keys()).some((key) => key.endsWith('-glossary'))).toBe(true);
  });

  it('groups the flat log per item, newest first, and keeps unknown keys legible', () => {
    const index = recommendationIndex(snapshot);
    const asset = snapshot.assets.find((a) => reviewCatalogAsset(a.id, snapshot).gaps.length > 0)!;
    const gapKey = recKey.catalogGap(asset.id, reviewCatalogAsset(asset.id, snapshot).gaps[0].id);

    const groups = groupEvents(
      [
        event({ id: 1, key: gapKey, at: '2026-10-19T09:00:00.000Z' }),
        event({ id: 4, key: 'gone-9f3', action: 'dismissed', at: '2026-10-21T09:00:00.000Z' }),
        event({ id: 2, key: gapKey, action: 'dismissed', at: '2026-10-20T09:00:00.000Z' }),
      ],
      index,
    );

    expect(groups.map((group) => group.key)).toEqual(['gone-9f3', gapKey]);
    expect(groups[0].ref).toBeUndefined();
    expect(groups[0].lastAt).toBe('2026-10-21T09:00:00.000Z');
    expect(groups[1].ref?.title).toBeTruthy();
    expect(groups[1].events.map((e) => e.id)).toEqual([2, 1]);
  });

  it('counts each steward once, busiest first', () => {
    expect(
      historyActors([
        event({ id: 1, key: 'a' }),
        event({ id: 2, key: 'b', actorId: 'u-2', actorName: 'Daniel Okafor' }),
        event({ id: 3, key: 'c' }),
      ]),
    ).toEqual([
      { id: 'u-1', name: 'Priya Raman', count: 2 },
      { id: 'u-2', name: 'Daniel Okafor', count: 1 },
    ]);
  });

  it('lays the trail out as a review-pack table with names, not ids', () => {
    const index = recommendationIndex(snapshot);
    const asset = snapshot.assets.find((a) => reviewCatalogAsset(a.id, snapshot).gaps.length > 0)!;
    const gap = reviewCatalogAsset(asset.id, snapshot).gaps[0];
    const key = recKey.catalogGap(asset.id, gap.id);
    const person = snapshot.people[0];
    const domainName = snapshot.domains.find((d) => d.id === asset.domainId)!.name;

    const rows = historyCsvRows(
      groupEvents(
        [
          event({
            id: 2,
            key,
            assigneeId: person.id,
            actorId: 'u-9',
            actorName: 'Priya Raman',
          }),
          event({ id: 1, key, action: 'dismissed', actorName: 'Priya Raman' }),
        ],
        index,
      ),
      {
        people: new Map(snapshot.people.map((p) => [p.id, p])),
        domains: new Map(snapshot.domains.map((d) => [d.id, d])),
      },
    );

    expect(rows[0]).toEqual([
      'Item key',
      'Item',
      'Detail',
      'Source',
      'Domain',
      'Activity',
      'Steward',
      'Assignee',
      'Recorded at (UTC)',
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual([
      key,
      gap.label,
      asset.name,
      'Catalog',
      domainName,
      'Accepted',
      'Priya Raman',
      person.name,
      '2026-10-20T09:00:00.000Z',
    ]);
    // A dismissal carries no assignee, and a withdrawal reads as its own verb.
    expect(rows[2].slice(5)).toEqual([
      'Dismissed',
      'Priya Raman',
      '',
      '2026-10-20T09:00:00.000Z',
    ]);
  });

  it('describes what each event actually did', () => {
    expect(eventLabel(event({ id: 1, key: 'a' }))).toBe('Accepted');
    expect(eventLabel(event({ id: 1, key: 'a', assigneeId: 'P-01' }), 'Ada Lovelace')).toBe(
      'Accepted and assigned to Ada Lovelace',
    );
    expect(eventLabel(event({ id: 1, key: 'a', action: 'dismissed', assigneeId: 'P-01' }))).toBe(
      'Dismissed',
    );
    expect(eventLabel(event({ id: 1, key: 'a', action: 'cleared' }))).toBe('Withdrew the decision');
  });
});
