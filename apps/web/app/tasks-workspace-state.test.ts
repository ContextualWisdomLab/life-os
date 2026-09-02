import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTasksWorkspaceState,
  reduceTasksWorkspaceState,
} from './tasks-workspace-state';

const goal = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Launch LifeOS',
});
const secondGoal = Object.freeze({
  id: '55555555-5555-4555-8555-555555555555',
  title: 'Harden the operating loop',
});
const project = Object.freeze({
  id: '22222222-2222-4222-8222-222222222222',
  goalId: goal.id,
  title: 'Ship authenticated planning workspace',
});
const secondProject = Object.freeze({
  id: '66666666-6666-4666-8666-666666666666',
  goalId: secondGoal.id,
  title: 'Close release evidence gaps',
});
const task = Object.freeze({
  id: '33333333-3333-4333-8333-333333333333',
  projectId: project.id,
  title: 'Wire durable Tasks workspace',
  status: 'todo' as const,
  createdAt: '2026-09-02T00:00:00.000Z',
});
const secondTask = Object.freeze({
  id: '77777777-7777-4777-8777-777777777777',
  projectId: secondProject.id,
  title: 'Verify release provenance',
  status: 'todo' as const,
  createdAt: '2026-09-02T01:00:00.000Z',
});

function goalsReadyState() {
  return reduceTasksWorkspaceState(createTasksWorkspaceState(), {
    type: 'goals-loaded',
    goals: [goal, secondGoal],
  });
}

function projectsReadyState() {
  const goalSelected = reduceTasksWorkspaceState(goalsReadyState(), {
    type: 'goal-selected',
    goalId: goal.id,
  });
  return reduceTasksWorkspaceState(goalSelected, {
    type: 'projects-loaded',
    goalId: goal.id,
    projects: [project],
  });
}

function tasksReadyState() {
  const projectSelected = reduceTasksWorkspaceState(projectsReadyState(), {
    type: 'project-selected',
    projectId: project.id,
  });
  return reduceTasksWorkspaceState(projectSelected, {
    type: 'tasks-loaded',
    projectId: project.id,
    tasks: [task],
  });
}

test('tasks workspace begins without inventing Goal or Project authority', () => {
  assert.deepEqual(createTasksWorkspaceState(), {
    status: 'loading',
    goals: [],
    selectedGoalId: null,
    projects: [],
    selectedProjectId: null,
    tasks: [],
    loadingProjects: false,
    loadingTasks: false,
    submitting: false,
    message: null,
  });
});

test('an unknown Goal cannot become browser scope authority', () => {
  const ready = goalsReadyState();
  assert.equal(
    reduceTasksWorkspaceState(ready, {
      type: 'goal-selected',
      goalId: '99999999-9999-4999-8999-999999999999',
    }),
    ready,
  );
});

test('selecting a Goal clears stale Project and Task evidence', () => {
  const selected = reduceTasksWorkspaceState(tasksReadyState(), {
    type: 'goal-selected',
    goalId: secondGoal.id,
  });
  assert.equal(selected.selectedGoalId, secondGoal.id);
  assert.equal(selected.selectedProjectId, null);
  assert.deepEqual(selected.projects, []);
  assert.deepEqual(selected.tasks, []);
  assert.equal(selected.loadingProjects, true);
  assert.equal(selected.loadingTasks, false);
});

test('an unknown Project cannot become browser scope authority', () => {
  const ready = projectsReadyState();
  assert.equal(
    reduceTasksWorkspaceState(ready, {
      type: 'project-selected',
      projectId: '99999999-9999-4999-8999-999999999999',
    }),
    ready,
  );
});

test('selecting a known Project opens Task loading without inventing Task evidence', () => {
  const selected = reduceTasksWorkspaceState(projectsReadyState(), {
    type: 'project-selected',
    projectId: project.id,
  });
  assert.equal(selected.selectedProjectId, project.id);
  assert.equal(selected.loadingTasks, true);
  assert.deepEqual(selected.tasks, []);
});

test('submission cannot start before an explicit durable Project selection', () => {
  const ready = projectsReadyState();
  assert.equal(
    reduceTasksWorkspaceState(ready, { type: 'submit-started' }),
    ready,
  );
});

test('late Task collections cannot cross a changed Project scope', () => {
  const firstProject = reduceTasksWorkspaceState(projectsReadyState(), {
    type: 'project-selected',
    projectId: project.id,
  });
  const secondGoalSelection = reduceTasksWorkspaceState(firstProject, {
    type: 'goal-selected',
    goalId: secondGoal.id,
  });
  const secondGoalProjects = reduceTasksWorkspaceState(secondGoalSelection, {
    type: 'projects-loaded',
    goalId: secondGoal.id,
    projects: [secondProject],
  });
  const secondProjectSelection = reduceTasksWorkspaceState(secondGoalProjects, {
    type: 'project-selected',
    projectId: secondProject.id,
  });
  const staleResponse = reduceTasksWorkspaceState(secondProjectSelection, {
    type: 'tasks-loaded',
    projectId: project.id,
    tasks: [task],
  });

  assert.equal(staleResponse, secondProjectSelection);
  assert.equal(staleResponse.selectedProjectId, secondProject.id);
  assert.deepEqual(staleResponse.tasks, []);
  assert.equal(staleResponse.loadingTasks, true);
});

test('late creation evidence cannot cross the selected Project scope', () => {
  const ready = tasksReadyState();
  const secondGoalSelection = reduceTasksWorkspaceState(ready, {
    type: 'goal-selected',
    goalId: secondGoal.id,
  });
  const secondGoalProjects = reduceTasksWorkspaceState(secondGoalSelection, {
    type: 'projects-loaded',
    goalId: secondGoal.id,
    projects: [secondProject],
  });
  const secondProjectSelection = reduceTasksWorkspaceState(secondGoalProjects, {
    type: 'project-selected',
    projectId: secondProject.id,
  });
  const staleCreation = reduceTasksWorkspaceState(secondProjectSelection, {
    type: 'submit-succeeded',
    task,
  });
  assert.equal(staleCreation, secondProjectSelection);

  const loaded = reduceTasksWorkspaceState(secondProjectSelection, {
    type: 'tasks-loaded',
    projectId: secondProject.id,
    tasks: [],
  });
  const created = reduceTasksWorkspaceState(loaded, {
    type: 'submit-succeeded',
    task: secondTask,
  });
  assert.deepEqual(created.tasks, [secondTask]);
});

test('duplicate Task identities are rejected instead of replacing durable evidence', () => {
  const loaded = tasksReadyState();
  assert.equal(
    reduceTasksWorkspaceState(loaded, {
      type: 'tasks-loaded',
      projectId: project.id,
      tasks: [task, task],
    }),
    loaded,
  );
  assert.equal(
    reduceTasksWorkspaceState(loaded, {
      type: 'submit-succeeded',
      task,
    }),
    loaded,
  );
});

test('validation, offline, auth, and dependency failures preserve loaded durable evidence', () => {
  const loaded = tasksReadyState();
  const submitting = reduceTasksWorkspaceState(loaded, { type: 'submit-started' });
  const invalid = reduceTasksWorkspaceState(submitting, { type: 'invalid-title' });
  assert.deepEqual(invalid.tasks, [task]);
  assert.equal(invalid.submitting, false);
  assert.equal(invalid.message, 'Enter a task between 1 and 160 characters.');

  const offline = reduceTasksWorkspaceState(loaded, { type: 'offline' });
  assert.equal(offline.status, 'offline');
  assert.deepEqual(offline.tasks, [task]);
  assert.equal(offline.submitting, false);

  const authenticationRequired = reduceTasksWorkspaceState(loaded, {
    type: 'authentication-required',
  });
  assert.equal(authenticationRequired.status, 'authentication-required');
  assert.deepEqual(authenticationRequired.tasks, [task]);
  assert.equal(authenticationRequired.submitting, false);

  const unavailable = reduceTasksWorkspaceState(loaded, { type: 'unavailable' });
  assert.equal(unavailable.status, 'unavailable');
  assert.deepEqual(unavailable.tasks, [task]);
  assert.equal(unavailable.loadingProjects, false);
  assert.equal(unavailable.loadingTasks, false);
});
