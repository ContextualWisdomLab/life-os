import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProjectsWorkspaceState,
  reduceProjectsWorkspaceState,
} from './projects-workspace-state';

const goal = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Launch LifeOS',
});
const secondGoal = Object.freeze({
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Harden the operating loop',
});
const project = Object.freeze({
  id: '22222222-2222-4222-8222-222222222222',
  goalId: goal.id,
  title: 'Ship authenticated planning workspace',
  createdAt: '2026-09-02T00:00:00.000Z',
});
const secondProject = Object.freeze({
  id: '44444444-4444-4444-8444-444444444444',
  goalId: secondGoal.id,
  title: 'Close release evidence gaps',
  createdAt: '2026-09-02T01:00:00.000Z',
});

function readyState() {
  return reduceProjectsWorkspaceState(createProjectsWorkspaceState(), {
    type: 'goals-loaded',
    goals: [goal, secondGoal],
  });
}

function loadedState() {
  const selected = reduceProjectsWorkspaceState(readyState(), {
    type: 'goal-selected',
    goalId: goal.id,
  });
  return reduceProjectsWorkspaceState(selected, {
    type: 'projects-loaded',
    goalId: goal.id,
    projects: [project],
  });
}

test('projects workspace begins without inventing a selected goal', () => {
  assert.deepEqual(createProjectsWorkspaceState(), {
    status: 'loading',
    goals: [],
    selectedGoalId: null,
    projects: [],
    loadingProjects: false,
    submitting: false,
    message: null,
  });
});

test('durable goals arrive before project scope is selected', () => {
  const state = readyState();
  assert.equal(state.status, 'ready');
  assert.equal(state.selectedGoalId, null);
  assert.deepEqual(state.projects, []);
});

test('selecting a known goal clears stale project evidence', () => {
  const selected = reduceProjectsWorkspaceState(readyState(), {
    type: 'goal-selected',
    goalId: goal.id,
  });
  assert.equal(selected.selectedGoalId, goal.id);
  assert.equal(selected.loadingProjects, true);
  assert.deepEqual(selected.projects, []);
});

test('an unknown goal cannot become browser scope authority', () => {
  const ready = readyState();
  const selected = reduceProjectsWorkspaceState(ready, {
    type: 'goal-selected',
    goalId: '55555555-5555-4555-8555-555555555555',
  });
  assert.equal(selected, ready);
});

test('successful project creation accepts only returned durable evidence', () => {
  const submitting = reduceProjectsWorkspaceState(loadedState(), {
    type: 'submit-started',
  });
  const created = reduceProjectsWorkspaceState(submitting, {
    type: 'submit-succeeded',
    project,
  });
  assert.equal(submitting.submitting, true);
  assert.deepEqual(created.projects, [project]);
  assert.equal(created.submitting, false);
  assert.equal(created.message, 'Project created.');
});

test('submission cannot start before a durable Goal is selected', () => {
  const ready = readyState();
  assert.equal(
    reduceProjectsWorkspaceState(ready, { type: 'submit-started' }),
    ready,
  );
});

test('a late project response cannot cross an explicitly changed Goal scope', () => {
  const firstSelection = reduceProjectsWorkspaceState(readyState(), {
    type: 'goal-selected',
    goalId: goal.id,
  });
  const secondSelection = reduceProjectsWorkspaceState(firstSelection, {
    type: 'goal-selected',
    goalId: secondGoal.id,
  });
  const staleResponse = reduceProjectsWorkspaceState(secondSelection, {
    type: 'projects-loaded',
    goalId: goal.id,
    projects: [project],
  });

  assert.equal(staleResponse, secondSelection);
  assert.equal(staleResponse.selectedGoalId, secondGoal.id);
  assert.deepEqual(staleResponse.projects, []);
  assert.equal(staleResponse.loadingProjects, true);
});

test('a late creation result cannot cross the selected Goal scope', () => {
  const secondSelection = reduceProjectsWorkspaceState(readyState(), {
    type: 'goal-selected',
    goalId: secondGoal.id,
  });
  const staleCreation = reduceProjectsWorkspaceState(secondSelection, {
    type: 'submit-succeeded',
    project,
  });
  assert.equal(staleCreation, secondSelection);

  const loaded = reduceProjectsWorkspaceState(secondSelection, {
    type: 'projects-loaded',
    goalId: secondGoal.id,
    projects: [],
  });
  const created = reduceProjectsWorkspaceState(loaded, {
    type: 'submit-succeeded',
    project: secondProject,
  });
  assert.deepEqual(created.projects, [secondProject]);
});

test('validation and dependency failures preserve loaded durable evidence', () => {
  const loaded = loadedState();
  const submitting = reduceProjectsWorkspaceState(loaded, {
    type: 'submit-started',
  });
  const invalid = reduceProjectsWorkspaceState(submitting, {
    type: 'invalid-title',
  });
  assert.deepEqual(invalid.projects, [project]);
  assert.equal(invalid.submitting, false);
  assert.equal(invalid.message, 'Enter a project between 1 and 160 characters.');

  const unavailable = reduceProjectsWorkspaceState(loaded, {
    type: 'unavailable',
  });
  assert.equal(unavailable.status, 'unavailable');
  assert.deepEqual(unavailable.projects, [project]);
  assert.equal(unavailable.loadingProjects, false);
});

test('authentication and offline failures preserve evidence but disable mutation', () => {
  const loaded = loadedState();
  const authenticationRequired = reduceProjectsWorkspaceState(loaded, {
    type: 'authentication-required',
  });
  assert.equal(authenticationRequired.status, 'authentication-required');
  assert.deepEqual(authenticationRequired.projects, [project]);
  assert.equal(authenticationRequired.submitting, false);

  const offline = reduceProjectsWorkspaceState(loaded, { type: 'offline' });
  assert.equal(offline.status, 'offline');
  assert.deepEqual(offline.projects, [project]);
  assert.equal(offline.submitting, false);
  assert.equal(
    offline.message,
    'You are offline. Existing projects remain visible but cannot change.',
  );
});
