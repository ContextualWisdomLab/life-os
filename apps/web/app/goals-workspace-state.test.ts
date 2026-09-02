import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGoalsWorkspaceState,
  reduceGoalsWorkspaceState,
} from './goals-workspace-state';

const firstGoal = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Ship the first usable LifeOS workspace',
  createdAt: '2026-09-02T00:00:00.000Z',
});

const secondGoal = Object.freeze({
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Keep the operating loop believable',
  createdAt: '2026-09-02T01:00:00.000Z',
});

test('goal workspace starts in a bounded loading state', () => {
  assert.deepEqual(createGoalsWorkspaceState(), {
    status: 'loading',
    goals: [],
    submitting: false,
    message: null,
  });
});

test('loaded goals become ready without inventing local authority', () => {
  const state = reduceGoalsWorkspaceState(createGoalsWorkspaceState(), {
    type: 'load-succeeded',
    goals: [firstGoal],
  });

  assert.equal(state.status, 'ready');
  assert.deepEqual(state.goals, [firstGoal]);
  assert.equal(state.submitting, false);
});

test('successful creation adds only returned durable evidence', () => {
  const loaded = reduceGoalsWorkspaceState(createGoalsWorkspaceState(), {
    type: 'load-succeeded',
    goals: [firstGoal],
  });
  const submitting = reduceGoalsWorkspaceState(loaded, {
    type: 'submit-started',
  });
  const created = reduceGoalsWorkspaceState(submitting, {
    type: 'submit-succeeded',
    goal: secondGoal,
  });

  assert.equal(submitting.submitting, true);
  assert.deepEqual(created.goals, [secondGoal, firstGoal]);
  assert.equal(created.submitting, false);
  assert.equal(created.message, 'Goal created.');
});

test('authentication and dependency failures keep prior durable evidence visible', () => {
  const loaded = reduceGoalsWorkspaceState(createGoalsWorkspaceState(), {
    type: 'load-succeeded',
    goals: [firstGoal],
  });

  const authenticationRequired = reduceGoalsWorkspaceState(loaded, {
    type: 'authentication-required',
  });
  assert.equal(authenticationRequired.status, 'authentication-required');
  assert.deepEqual(authenticationRequired.goals, [firstGoal]);

  const unavailable = reduceGoalsWorkspaceState(loaded, {
    type: 'unavailable',
  });
  assert.equal(unavailable.status, 'unavailable');
  assert.deepEqual(unavailable.goals, [firstGoal]);
});

test('offline state is explicit and never clears durable evidence', () => {
  const loaded = reduceGoalsWorkspaceState(createGoalsWorkspaceState(), {
    type: 'load-succeeded',
    goals: [firstGoal],
  });
  const offline = reduceGoalsWorkspaceState(loaded, { type: 'offline' });

  assert.equal(offline.status, 'offline');
  assert.deepEqual(offline.goals, [firstGoal]);
  assert.equal(offline.submitting, false);
});
