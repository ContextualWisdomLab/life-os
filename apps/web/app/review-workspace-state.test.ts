import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReviewWorkspaceState,
  reduceReviewWorkspaceState,
  type ReviewWorkspaceRecord,
} from './review-workspace-state';

const REVIEW_ID = '00000000-0000-4000-8000-000000000201';
const SECOND_REVIEW_ID = '00000000-0000-4000-8000-000000000202';

function record(
  id = REVIEW_ID,
  periodStartDate = '2026-08-31',
): ReviewWorkspaceRecord {
  return Object.freeze({
    id,
    ritualKind: 'weekly-review' as const,
    periodStartDate,
    completedStepCount: 5,
    totalStepCount: 5,
    plannedItemCount: 8,
    completedItemCount: 6,
    habitCompletionCount: 9,
    reflection: 'Keep the next week smaller and explicit.',
    completedAt: '2026-09-02T10:00:00.000Z',
    recordedAt: '2026-09-02T10:00:01.000Z',
  });
}

test('starts without inventing durable Review evidence', () => {
  const state = createReviewWorkspaceState();
  assert.equal(state.status, 'loading');
  assert.equal(state.submitting, false);
  assert.deepEqual(state.records, []);
});

test('accepts one bounded immutable history collection', () => {
  const initial = createReviewWorkspaceState();
  const state = reduceReviewWorkspaceState(initial, {
    type: 'history-loaded',
    records: [record(), record(SECOND_REVIEW_ID, '2026-08-24')],
  });
  assert.equal(state.status, 'ready');
  assert.equal(state.records.length, 2);
  assert.equal(state.records[0]?.id, REVIEW_ID);
});

test('rejects duplicate or malformed history without discarding accepted evidence', () => {
  const ready = reduceReviewWorkspaceState(createReviewWorkspaceState(), {
    type: 'history-loaded',
    records: [record()],
  });
  const duplicate = reduceReviewWorkspaceState(ready, {
    type: 'history-loaded',
    records: [record(), record()],
  });
  assert.equal(duplicate.status, 'unavailable');
  assert.equal(duplicate.records.length, 1);

  const malformed = reduceReviewWorkspaceState(ready, {
    type: 'history-loaded',
    records: [
      {
        ...record(SECOND_REVIEW_ID),
        completedItemCount: 9,
      },
    ],
  });
  assert.equal(malformed.status, 'unavailable');
  assert.equal(malformed.records[0]?.id, REVIEW_ID);
});

test('rejects two Weekly Review records for the same Monday even when IDs differ', () => {
  const state = reduceReviewWorkspaceState(createReviewWorkspaceState(), {
    type: 'history-loaded',
    records: [record(), record(SECOND_REVIEW_ID)],
  });
  assert.equal(state.status, 'unavailable');
  assert.deepEqual(state.records, []);
});

test('requires an active explicit submission before accepting completion evidence', () => {
  const ready = reduceReviewWorkspaceState(createReviewWorkspaceState(), {
    type: 'history-loaded',
    records: [],
  });
  const unsolicited = reduceReviewWorkspaceState(ready, {
    type: 'submit-succeeded',
    record: record(),
  });
  assert.deepEqual(unsolicited, ready);

  const submitting = reduceReviewWorkspaceState(ready, { type: 'submit-started' });
  assert.equal(submitting.submitting, true);
  const completed = reduceReviewWorkspaceState(submitting, {
    type: 'submit-succeeded',
    record: record(),
  });
  assert.equal(completed.submitting, false);
  assert.equal(completed.records[0]?.id, REVIEW_ID);
});

test('invalid or duplicate completion evidence fails closed and releases the mutation lock', () => {
  const ready = reduceReviewWorkspaceState(createReviewWorkspaceState(), {
    type: 'history-loaded',
    records: [record()],
  });
  const submitting = reduceReviewWorkspaceState(ready, { type: 'submit-started' });
  const duplicate = reduceReviewWorkspaceState(submitting, {
    type: 'submit-succeeded',
    record: record(),
  });
  assert.equal(duplicate.status, 'unavailable');
  assert.equal(duplicate.submitting, false);
  assert.equal(duplicate.records.length, 1);
});

test('conflict, authentication, offline, and dependency failures preserve durable history', () => {
  const ready = reduceReviewWorkspaceState(createReviewWorkspaceState(), {
    type: 'history-loaded',
    records: [record()],
  });
  for (const action of [
    { type: 'conflict' as const },
    { type: 'authentication-required' as const },
    { type: 'offline' as const },
    { type: 'unavailable' as const },
  ]) {
    const submitting = reduceReviewWorkspaceState(ready, { type: 'submit-started' });
    const state = reduceReviewWorkspaceState(submitting, action);
    assert.equal(state.submitting, false);
    assert.equal(state.records[0]?.id, REVIEW_ID);
  }
});
