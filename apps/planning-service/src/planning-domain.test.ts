import { describe, expect, it } from 'vitest';
import { InMemoryPlanningRepository, PlanningService } from './planning-domain';

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
