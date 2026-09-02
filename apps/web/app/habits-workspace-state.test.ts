import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHabitsWorkspaceState,
  reduceHabitsWorkspaceState,
  type HabitsWorkspaceHabit,
} from './habits-workspace-state';

const habit = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Review the day',
  timezone: 'Asia/Seoul',
  startsOn: '2026-09-02',
  recurrence: Object.freeze({ kind: 'daily' as const, interval: 1 }),
  createdAt: '2026-09-02T11:30:00.000Z',
});
const secondHabit = Object.freeze({
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Plan the week',
  timezone: 'Asia/Seoul',
  startsOn: '2026-09-07',
  recurrence: Object.freeze({
    kind: 'weekly' as const,
    interval: 1,
    weekdays: Object.freeze([1]),
  }),
  createdAt: '2026-09-02T11:31:00.000Z',
});

function loadedState() {
  return reduceHabitsWorkspaceState(createHabitsWorkspaceState(), {
    type: 'habits-loaded',
    habits: [habit],
  });
}

test('Habits workspace begins without inventing durable Habit evidence', () => {
  assert.deepEqual(createHabitsWorkspaceState(), {
    status: 'loading',
    habits: [],
    submitting: false,
    message: null,
  });
});

test('valid durable Habit collections become ready state', () => {
  const loaded = loadedState();
  assert.equal(loaded.status, 'ready');
  assert.deepEqual(loaded.habits, [habit]);
  assert.equal(loaded.submitting, false);
  assert.equal(loaded.message, null);
});

test('duplicate or malformed durable Habit evidence is rejected', () => {
  const initial = createHabitsWorkspaceState();
  assert.equal(
    reduceHabitsWorkspaceState(initial, {
      type: 'habits-loaded',
      habits: [habit, habit],
    }),
    initial,
  );

  const nonCanonicalTimestamp: HabitsWorkspaceHabit = {
    ...habit,
    id: '33333333-3333-4333-8333-333333333333',
    createdAt: '2026-09-02T20:30:00+09:00',
  };
  assert.equal(
    reduceHabitsWorkspaceState(initial, {
      type: 'habits-loaded',
      habits: [nonCanonicalTimestamp],
    }),
    initial,
  );

  const invalidWeekdays: HabitsWorkspaceHabit = {
    ...secondHabit,
    id: '44444444-4444-4444-8444-444444444444',
    recurrence: { kind: 'weekly', interval: 1, weekdays: [1, 1] },
  };
  assert.equal(
    reduceHabitsWorkspaceState(initial, {
      type: 'habits-loaded',
      habits: [invalidWeekdays],
    }),
    initial,
  );
});

test('Habit creation requires an explicit active submission', () => {
  const loaded = loadedState();
  assert.equal(
    reduceHabitsWorkspaceState(loaded, {
      type: 'submit-succeeded',
      habit: secondHabit,
    }),
    loaded,
  );

  const submitting = reduceHabitsWorkspaceState(loaded, {
    type: 'submit-started',
  });
  assert.equal(submitting.submitting, true);
  const created = reduceHabitsWorkspaceState(submitting, {
    type: 'submit-succeeded',
    habit: secondHabit,
  });
  assert.equal(created.submitting, false);
  assert.deepEqual(created.habits, [habit, secondHabit]);
  assert.equal(created.message, 'Habit created.');
});

test('duplicate creation evidence cannot replace an existing Habit', () => {
  const loaded = loadedState();
  const submitting = reduceHabitsWorkspaceState(loaded, {
    type: 'submit-started',
  });
  assert.equal(
    reduceHabitsWorkspaceState(submitting, {
      type: 'submit-succeeded',
      habit,
    }),
    submitting,
  );
});

test('validation, offline, auth, and dependency failures preserve accepted evidence', () => {
  const loaded = loadedState();
  const submitting = reduceHabitsWorkspaceState(loaded, {
    type: 'submit-started',
  });

  const invalid = reduceHabitsWorkspaceState(submitting, {
    type: 'invalid-input',
  });
  assert.deepEqual(invalid.habits, [habit]);
  assert.equal(invalid.submitting, false);
  assert.equal(invalid.message, 'Check the habit title, timezone, start date, and recurrence.');

  const offline = reduceHabitsWorkspaceState(loaded, { type: 'offline' });
  assert.equal(offline.status, 'offline');
  assert.deepEqual(offline.habits, [habit]);
  assert.equal(offline.submitting, false);

  const authenticationRequired = reduceHabitsWorkspaceState(loaded, {
    type: 'authentication-required',
  });
  assert.equal(authenticationRequired.status, 'authentication-required');
  assert.deepEqual(authenticationRequired.habits, [habit]);

  const unavailable = reduceHabitsWorkspaceState(loaded, { type: 'unavailable' });
  assert.equal(unavailable.status, 'unavailable');
  assert.deepEqual(unavailable.habits, [habit]);
});
