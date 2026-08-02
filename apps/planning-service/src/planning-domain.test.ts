import { describe, expect, it } from 'vitest';
import { InMemoryPlanningRepository, PlanningService } from './planning-domain';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('PlanningService', () => {
  it('creates a Goal → Project → Task hierarchy inside one workspace', () => {
    const service = new PlanningService(new InMemoryPlanningRepository());

    const goal = service.createGoal('workspace-a', { title: 'Publish LifeOS' });
    const project = service.createProject('workspace-a', {
      goalId: goal.id,
      title: 'Planning MVP',
    });
    const task = service.createTask('workspace-a', {
      projectId: project.id,
      title: 'Implement tenant isolation',
    });

    expect(service.listGoals('workspace-a')).toEqual([goal]);
    expect(service.listProjects('workspace-a', goal.id)).toEqual([project]);
    expect(service.listTasks('workspace-a', project.id)).toEqual([task]);
  });

  it('generates opaque UUIDv4 identifiers instead of numeric or sequential IDs', () => {
    const service = new PlanningService(new InMemoryPlanningRepository());
    const goal = service.createGoal('workspace-a', { title: 'Opaque identifiers' });
    const project = service.createProject('workspace-a', {
      goalId: goal.id,
      title: 'Project',
    });
    const task = service.createTask('workspace-a', {
      projectId: project.id,
      title: 'Task',
    });

    for (const id of [goal.id, project.id, task.id]) {
      expect(id).toMatch(UUID_V4_PATTERN);
      expect(id).not.toMatch(/^\d+$/);
    }
  });

  it('rejects numeric-only workspace identifiers', () => {
    const service = new PlanningService(new InMemoryPlanningRepository());

    expect(() => service.createGoal('123456', { title: 'Unsafe tenant ID' })).toThrowError(
      'Identifier must be an opaque non-numeric string',
    );
  });

  it('does not expose records from another workspace', () => {
    const service = new PlanningService(new InMemoryPlanningRepository());

    service.createGoal('workspace-a', { title: 'Private goal' });

    expect(service.listGoals('workspace-b')).toEqual([]);
  });

  it('rejects a project whose goal belongs to another workspace', () => {
    const service = new PlanningService(new InMemoryPlanningRepository());
    const goal = service.createGoal('workspace-a', { title: 'Workspace A goal' });

    expect(() =>
      service.createProject('workspace-b', {
        goalId: goal.id,
        title: 'Cross-tenant project',
      }),
    ).toThrowError('Goal not found');
  });

  it('rejects blank titles', () => {
    const service = new PlanningService(new InMemoryPlanningRepository());

    expect(() => service.createGoal('workspace-a', { title: '   ' })).toThrowError(
      'Title is required',
    );
  });
});
