import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addTodayAction,
  createEmptyTodayDraft,
  parseTodayDraft,
  scheduleTodayAction,
  TodayPriorityLimitError,
  TodayScheduleConflictError,
  TodayValidationError,
  toggleTodayCompletion,
  toggleTodayPriority,
} from './today-state';
import { parseStoredTodayDraft, serializeTodayDraft } from './today-storage';

const DATE = '2026-08-04';
const CREATED_AT = '2026-08-04T00:00:00.000Z';
const IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
] as const;

function withActions(count: number) {
  let draft = createEmptyTodayDraft(DATE);
  for (let index = 0; index < count; index += 1) {
    draft = addTodayAction(draft, {
      id: IDS[index] as string,
      title: `Visible action ${index + 1}`,
      createdAt: new Date(Date.parse(CREATED_AT) + index * 1_000).toISOString(),
    });
  }
  return draft;
}

describe('Today draft', () => {
  it('captures bounded opaque actions and commits no more than three priorities', () => {
    let draft = withActions(4);
    draft = toggleTodayPriority(draft, IDS[0]);
    draft = toggleTodayPriority(draft, IDS[1]);
    draft = toggleTodayPriority(draft, IDS[2]);

    assert.deepEqual(
      draft.actions.map((action) => action.priority),
      [1, 2, 3, null],
    );
    assert.throws(
      () => toggleTodayPriority(draft, IDS[3]),
      TodayPriorityLimitError,
    );
    assert.throws(
      () =>
        addTodayAction(draft, {
          id: '42',
          title: 'Numeric identifier',
          createdAt: CREATED_AT,
        }),
      TodayValidationError,
    );
  });

  it('rejects overlapping time blocks and preserves a valid prior draft', () => {
    let draft = withActions(2);
    draft = toggleTodayPriority(draft, IDS[0]);
    draft = toggleTodayPriority(draft, IDS[1]);
    draft = scheduleTodayAction(draft, IDS[0], 9 * 60, 60);

    assert.throws(
      () => scheduleTodayAction(draft, IDS[1], 9 * 60 + 45, 60),
      TodayScheduleConflictError,
    );
    assert.equal(draft.actions[1]?.startMinute, null);

    const adjacent = scheduleTodayAction(draft, IDS[1], 10 * 60, 60);
    assert.equal(adjacent.actions[1]?.startMinute, 10 * 60);
  });

  it('records completion evidence while retaining the committed priority', () => {
    let draft = toggleTodayPriority(withActions(1), IDS[0]);
    draft = scheduleTodayAction(draft, IDS[0], 23 * 60, 60);
    draft = toggleTodayCompletion(draft, IDS[0], '2026-08-04T23:59:00.000Z');

    assert.equal(draft.actions[0]?.status, 'done');
    assert.equal(draft.actions[0]?.priority, 1);
    assert.equal(draft.actions[0]?.completedAt, '2026-08-04T23:59:00.000Z');
  });

  it('round-trips a deterministic browser draft and resets on a new local day', () => {
    let draft = toggleTodayPriority(withActions(1), IDS[0]);
    draft = scheduleTodayAction(draft, IDS[0], 8 * 60, 30);
    const serialized = serializeTodayDraft(draft);

    assert.deepEqual(parseStoredTodayDraft(serialized, DATE), draft);
    assert.deepEqual(
      parseStoredTodayDraft(serialized, '2026-08-05'),
      createEmptyTodayDraft('2026-08-05'),
    );
    assert.deepEqual(
      parseStoredTodayDraft('{not-json', DATE),
      createEmptyTodayDraft(DATE),
    );
  });

  it('fails closed on duplicate IDs, priority collisions, and unknown fields', () => {
    const action = withActions(1).actions[0];
    assert.ok(action);

    assert.throws(
      () =>
        parseTodayDraft(
          {
            version: 'life-os.today-draft.v1',
            date: DATE,
            actions: [action, action],
          },
          DATE,
        ),
      TodayValidationError,
    );
    assert.throws(
      () =>
        parseTodayDraft(
          {
            version: 'life-os.today-draft.v1',
            date: DATE,
            actions: [
              { ...action, priority: 1 },
              { ...action, id: IDS[1], priority: 1 },
            ],
          },
          DATE,
        ),
      TodayValidationError,
    );
    assert.throws(
      () =>
        parseTodayDraft(
          {
            version: 'life-os.today-draft.v1',
            date: DATE,
            actions: [{ ...action, hiddenWorkspaceId: IDS[3] }],
          },
          DATE,
        ),
      TodayValidationError,
    );
  });
});
