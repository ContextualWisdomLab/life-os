import { describe, expect, it } from 'vitest';
import { InMemoryPlanningRepository, PlanningService } from './planning-domain';

describe('Planning task deadline persistence capability', () => {
  it('fails closed when a non-null deadline has no durable deadline repository', async () => {
    const repository = new InMemoryPlanningRepository();
    const service = new PlanningService(repository);
    const workspaceId = 'workspace-deadline-capability';

    const goal = await service.createGoal(workspaceId, {
      title: 'Deadline authority goal',
    });
    const project = await service.createProject(workspaceId, {
      goalId: goal.id,
      title: 'Deadline authority project',
    });

    await expect(
      service.createTask(workspaceId, {
        projectId: project.id,
        title: 'Deadline-bearing task',
        dueAt: '2026-09-19T09:00:00.123Z',
      }),
    ).rejects.toThrow('Task deadline persistence authority is unavailable');

    await expect(service.listTasks(workspaceId, project.id)).resolves.toEqual(
      [],
    );
  });
});
