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
const project = Object.freeze({
  id: '22222222-2222-4222-8222-222222222222',
  goalId: goal.id,
  title: 'Ship authenticated planning workspace',
  createdAt: '2026-09-02T00:00:00.000Z',
});

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
  const state = reduceProjectsWorkspaceState(createProjectsWorkspaceState(), {
    type: 'goals-loaded',
    goals: [goal],
  });
  assert.equal(state.status, 'ready');
  assert.equal(state.selectedGoalId, null);
  assert.deepEqual(state.projects, []);
});

test('selecting a goal clears stale project evidence', () => {
  const ready = reduceProjectsWorkspaceState(createProjectsWorkspaceState(), {
    type: 'goals-loaded',
    goals: [goal],
  });
  const selected = reduceProjectsWorkspaceState(ready, {
    type: 'goal-selected',
    goalId: goal.id,
  });
  assert.equal(selected.selectedGoalId, goal.id);
  assert.equal(selected.loadingProjects, true);
  assert.deepEqual(selected.projects, []);
});

test('successful project creation accepts only returned durable evidence', () => {
  const selected = reduceProjectsWorkspaceState(
    reduceProjectsWorkspaceState(createProjectsWorkspaceState(), {
      type: 'goals-loaded',
      goals: [goal],
    }),
    { type: 'goal-selected', goalId: goal.id },
  );
  const loaded = reduceProjectsWorkspaceState(selected, {
    type: 'projects-loaded',
    projects: [],
  });
  const submitting = reduceProjectsWorkspaceState(loaded, {
    type: 'submit-started',
  });
  const created = reduceProjectsWorkspaceState(submitting, {
    type: 'submit-succeeded',
    project,
  });
  assert.equal(submitting.submitting, true);
  assert.deepEqual(created.projects, [project]);
  assert.equal(created.submitting, false);
});

test('offline failure preserves previously loaded project evidence', () => {
  const selected = reduceProjectsWorkspaceState(
    reduceProjectsWorkspaceState(createProjectsWorkspaceState(), {
      type: 'goals-loaded',
      goals: [goal],
    }),
    { type: 'goal-selected', goalId: goal.id },
  );
  const loaded = reduceProjectsWorkspaceState(selected, {
    type: 'projects-loaded',
    projects: [project],
  });
  const offline = reduceProjectsWorkspaceState(loaded, { type: 'offline' });
  assert.equal(offline.status, 'offline');
  assert.deepEqual(offline.projects, [project]);
  assert.equal(offline.submitting, false);
});
