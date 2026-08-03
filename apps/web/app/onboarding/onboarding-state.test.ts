import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addTodayAction,
  createEmptyTodayDraft,
  scheduleTodayAction,
  toggleTodayPriority,
} from '../today-state';
import {
  createFirstRunPlan,
  parseStoredOnboardingCompletion,
  serializeOnboardingCompletion,
} from './onboarding-state';

const DATE = '2026-08-04';
const CREATED_AT = '2026-08-04T00:00:00.000Z';
const EXISTING_ID = '3b237d04-e84c-4ac4-933d-7f179865e1a0';
const NEW_ID = '59b7f370-b733-435d-a72a-40878d6cffd1';

function existingPriority() {
  let draft = addTodayAction(createEmptyTodayDraft(DATE), {
    id: EXISTING_ID,
    title: 'Existing priority',
    createdAt: CREATED_AT,
  });
  draft = toggleTodayPriority(draft, EXISTING_ID);
  return scheduleTodayAction(draft, EXISTING_ID, 9 * 60, 60);
}

test('creates a first priority while preserving the existing draft', () => {
  const currentDraft = existingPriority();
  const result = createFirstRunPlan({
    currentDraft,
    weeklyFocus: 'Make launch decisions clear',
    actionTitle: 'Draft the launch brief',
    actionId: NEW_ID,
    createdAt: '2026-08-04T00:01:00.000Z',
    startTime: '10:00',
    durationMinutes: 60,
  });

  assert.equal(result.draft.actions.length, 2);
  assert.equal(result.draft.actions[0]?.id, EXISTING_ID);
  assert.equal(result.draft.actions[0]?.startMinute, 9 * 60);
  assert.equal(result.draft.actions[1]?.id, NEW_ID);
  assert.equal(result.draft.actions[1]?.priority, 2);
  assert.equal(result.draft.actions[1]?.startMinute, 10 * 60);
  assert.equal(result.completion.placement, 'priority');
});

test('fails without mutating the caller draft when a time block overlaps', () => {
  const currentDraft = existingPriority();
  assert.throws(
    () =>
      createFirstRunPlan({
        currentDraft,
        weeklyFocus: 'Make launch decisions clear',
        actionTitle: 'Draft the launch brief',
        actionId: NEW_ID,
        createdAt: '2026-08-04T00:01:00.000Z',
        startTime: '09:30',
        durationMinutes: 60,
      }),
    { name: 'TodayScheduleConflictError' },
  );
  assert.equal(currentDraft.actions.length, 1);
  assert.equal(currentDraft.actions[0]?.id, EXISTING_ID);
});

test('uses backlog when all three priority positions are occupied', () => {
  let draft = createEmptyTodayDraft(DATE);
  const identifiers = [
    '3b237d04-e84c-4ac4-933d-7f179865e1a0',
    '474c83ae-08af-4a63-957b-49eb2093a61d',
    'e021b411-f75e-4490-97a4-f1f6ee811849',
  ];
  for (const [index, id] of identifiers.entries()) {
    draft = addTodayAction(draft, {
      id,
      title: `Priority ${index + 1}`,
      createdAt: `2026-08-04T00:0${index}:00.000Z`,
    });
    draft = toggleTodayPriority(draft, id);
  }

  const result = createFirstRunPlan({
    currentDraft: draft,
    weeklyFocus: 'Protect the existing commitments',
    actionTitle: 'Capture one later action',
    actionId: NEW_ID,
    createdAt: '2026-08-04T00:10:00.000Z',
  });
  assert.equal(result.completion.placement, 'backlog');
  assert.equal(
    result.draft.actions.find((action) => action.id === NEW_ID)?.priority,
    null,
  );
});

test('round-trips only bounded exact completion receipts', () => {
  const result = createFirstRunPlan({
    currentDraft: createEmptyTodayDraft(DATE),
    weeklyFocus: 'Make launch decisions clear',
    actionTitle: 'Draft the launch brief',
    actionId: NEW_ID,
    createdAt: CREATED_AT,
  });
  const serialized = serializeOnboardingCompletion(result.completion);
  assert.deepEqual(
    parseStoredOnboardingCompletion(serialized),
    result.completion,
  );
  assert.equal(
    parseStoredOnboardingCompletion(
      JSON.stringify({ ...result.completion, unexpected: true }),
    ),
    null,
  );
  assert.equal(parseStoredOnboardingCompletion('x'.repeat(20_000)), null);
});
