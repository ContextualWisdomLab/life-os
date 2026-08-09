import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectBuyerGapSnapshot,
  evaluateBuyerGaps,
  validateBuyerGapRegistry,
} from './buyer-gaps.mjs';

const manifest = Object.freeze({
  schema: 'life-os.capability-manifest.v1',
  capabilities: Object.freeze([
    Object.freeze({ id: 'planning.durable-data' }),
    Object.freeze({ id: 'today.action-loop' }),
    Object.freeze({ id: 'calendar.time-blocking' }),
    Object.freeze({ id: 'integrations.plugin-surface' }),
  ]),
});

function registry(gaps) {
  return {
    schema: 'life-os.commercial-buyer-gaps.v1',
    gaps,
  };
}

function gap(overrides = {}) {
  return {
    gap_id: 'today.multi-device-sync',
    issue_number: 121,
    capability_ids: ['planning.durable-data', 'today.action-loop'],
    ...overrides,
  };
}

function snapshot(issues) {
  return {
    schema: 'life-os.github-snapshot.v1',
    repository: 'ContextualWisdomLab/life-os',
    commit_sha: 'a'.repeat(40),
    generated_at: '2026-08-09T11:00:00.000Z',
    truncated: false,
    pull_requests: [],
    issues,
  };
}

describe('validateBuyerGapRegistry', () => {
  it('accepts a bounded repository-owned registry and freezes normalized entries', () => {
    const result = validateBuyerGapRegistry(registry([gap()]), manifest);
    assert.equal(result.schema, 'life-os.commercial-buyer-gaps.v1');
    assert.equal(result.gaps[0].gap_id, 'today.multi-device-sync');
    assert.deepEqual(result.gaps[0].capability_ids, [
      'planning.durable-data',
      'today.action-loop',
    ]);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.gaps), true);
    assert.equal(Object.isFrozen(result.gaps[0].capability_ids), true);
  });

  it('rejects duplicate policy ownership, unknown capabilities, and malformed identifiers', () => {
    const invalidRegistries = [
      registry([gap(), gap()]),
      registry([
        gap(),
        gap({
          gap_id: 'calendar.per-user-credentials',
          capability_ids: ['calendar.time-blocking'],
        }),
      ]),
      registry([gap({ capability_ids: ['missing.capability'] })]),
      registry([gap({ gap_id: '121' })]),
      registry([gap({ issue_number: '121' })]),
      registry([gap({ capability_ids: [] })]),
      registry([
        gap({ capability_ids: ['today.action-loop', 'today.action-loop'] }),
      ]),
    ];

    for (const value of invalidRegistries) {
      assert.throws(
        () => validateBuyerGapRegistry(value, manifest),
        /Invalid buyer gap registry/,
      );
    }
  });
});

describe('collectBuyerGapSnapshot', () => {
  it('retains only bounded registered issue state and makes fetch failure unknown', async () => {
    const validated = validateBuyerGapRegistry(
      registry([
        gap(),
        gap({
          gap_id: 'calendar.per-user-credentials',
          issue_number: 129,
          capability_ids: ['calendar.time-blocking'],
        }),
      ]),
      manifest,
    );
    const requested = [];
    const client = {
      async requestJson(path) {
        requested.push(path);
        if (path.endsWith('/121')) {
          return {
            number: 121,
            title: 'untrusted title not retained',
            body: 'untrusted body not retained',
            state: 'open',
            state_reason: null,
            labels: [{ name: 'buyer-gap' }],
          };
        }
        throw new Error('provider unavailable');
      },
    };

    const result = await collectBuyerGapSnapshot(
      client,
      'ContextualWisdomLab/life-os',
      validated,
      '2026-08-09T11:00:00.000Z',
    );

    assert.deepEqual(requested, [
      '/repos/ContextualWisdomLab/life-os/issues/121',
      '/repos/ContextualWisdomLab/life-os/issues/129',
    ]);
    assert.deepEqual(result.issues, [
      {
        number: 121,
        state: 'open',
        state_reason: null,
        labels: ['buyer-gap'],
      },
      { number: 129, state: 'unknown', state_reason: null, labels: [] },
    ]);
    assert.equal(JSON.stringify(result).includes('untrusted title'), false);
    assert.equal(JSON.stringify(result).includes('untrusted body'), false);
  });
});

describe('evaluateBuyerGaps', () => {
  it('keeps an open canonical gap unresolved even when its capabilities are already mature', () => {
    const validated = validateBuyerGapRegistry(registry([gap()]), manifest);
    const result = evaluateBuyerGaps(
      validated,
      snapshot([
        {
          number: 121,
          title: 'Durable Today synchronization',
          state: 'open',
          state_reason: null,
          labels: [],
        },
      ]),
    );

    assert.equal(result.unresolved.length, 1);
    assert.equal(result.unresolved[0].gap_id, 'today.multi-device-sync');
    assert.equal(result.unresolved[0].issue_number, 121);
    assert.equal(result.unresolved[0].state, 'open');
    assert.deepEqual(result.unknown, []);
  });

  it('treats closed completed, duplicate-labeled, and not-planned issues as resolved', () => {
    const validated = validateBuyerGapRegistry(
      registry([
        gap(),
        gap({
          gap_id: 'calendar.per-user-credentials',
          issue_number: 129,
          capability_ids: ['calendar.time-blocking'],
        }),
        gap({
          gap_id: 'plugins.runtime-delivery',
          issue_number: 130,
          capability_ids: ['integrations.plugin-surface'],
        }),
      ]),
      manifest,
    );
    const result = evaluateBuyerGaps(
      validated,
      snapshot([
        {
          number: 121,
          title: 'Today',
          state: 'closed',
          state_reason: 'completed',
          labels: [],
        },
        {
          number: 129,
          title: 'Calendar',
          state: 'closed',
          state_reason: null,
          labels: ['duplicate'],
        },
        {
          number: 130,
          title: 'Plugin',
          state: 'closed',
          state_reason: 'not_planned',
          labels: [],
        },
      ]),
    );

    assert.equal(result.unresolved.length, 0);
    assert.equal(result.unknown.length, 0);
    assert.deepEqual(
      result.resolved.map((item) => [item.gap_id, item.resolution]),
      [
        ['today.multi-device-sync', 'completed'],
        ['calendar.per-user-credentials', 'duplicate'],
        ['plugins.runtime-delivery', 'not_planned'],
      ],
    );
  });

  it('fails closed to an explicit unknown state when registered issue evidence is missing', () => {
    const validated = validateBuyerGapRegistry(registry([gap()]), manifest);
    const result = evaluateBuyerGaps(validated, snapshot([]));

    assert.equal(result.unresolved.length, 0);
    assert.equal(result.unknown.length, 1);
    assert.deepEqual(result.unknown[0], {
      gap_id: 'today.multi-device-sync',
      issue_number: 121,
      capability_ids: ['planning.durable-data', 'today.action-loop'],
      state: 'unknown',
      resolution: null,
    });
  });

  it('sorts evidence deterministically and ignores unregistered ordinary issues', () => {
    const validated = validateBuyerGapRegistry(
      registry([
        gap({
          gap_id: 'plugins.runtime-delivery',
          issue_number: 130,
          capability_ids: ['integrations.plugin-surface'],
        }),
        gap(),
      ]),
      manifest,
    );
    const result = evaluateBuyerGaps(
      validated,
      snapshot([
        {
          number: 999,
          title: 'Ordinary issue',
          state: 'open',
          state_reason: null,
          labels: [],
        },
        {
          number: 130,
          title: 'Plugin runtime',
          state: 'open',
          state_reason: null,
          labels: [],
        },
        {
          number: 121,
          title: 'Today sync',
          state: 'open',
          state_reason: null,
          labels: [],
        },
      ]),
    );

    assert.deepEqual(
      result.unresolved.map((item) => item.issue_number),
      [121, 130],
    );
    assert.equal(
      result.unresolved.some((item) => item.issue_number === 999),
      false,
    );
  });
});
