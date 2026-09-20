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
const project = Object.freeze({
  id: '22222222-2222-4222-8222-222222222222',
  goalId: goal.id,
  title: 'Ship authenticated planning workspace',
});
const task = Object.freeze({
  id: '33333333-3333-4333-8333-333333333333',
  projectId: project.id,
  title: 'Verify exact-head evidence',
  status: 'todo' as const,
  createdAt: '2026-09-02T11:20:00.000Z',
});

function readyProjectState() {
  const goalsLoaded = reduceTasksWorkspaceState(createTasksWorkspaceState(), {
    type: 'goals-loaded',
    goals: [goal],
  });
  const goalSelected = reduceTasksWorkspaceState(goalsLoaded, {
    type: 'goal-selected',
    goalId: goal.id,
  });
  const projectsLoaded = reduceTasksWorkspaceState(goalSelected, {
    type: 'projects-loaded',
    goalId: goal.id,
    projects: [project],
  });
  const projectSelected = reduceTasksWorkspaceState(projectsLoaded, {
    type: 'project-selected',
    projectId: project.id,
  });
  return reduceTasksWorkspaceState(projectSelected, {
    type: 'tasks-loaded',
    projectId: project.id,
    tasks: [],
  });
}

test('Task creation evidence is accepted only for an active explicit submission', () => {
  const ready = readyProjectState();
  const unsolicited = reduceTasksWorkspaceState(ready, {
    type: 'submit-succeeded',
    task,
  });
  assert.equal(unsolicited, ready);
  assert.deepEqual(unsolicited.tasks, []);

  const submitting = reduceTasksWorkspaceState(ready, { type: 'submit-started' });
  const accepted = reduceTasksWorkspaceState(submitting, {
    type: 'submit-succeeded',
    task,
  });
  assert.deepEqual(accepted.tasks, [task]);
  assert.equal(accepted.submitting, false);
});
