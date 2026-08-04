import { describe, expect, it } from 'vitest';
import { InMemoryPlanningRepository, PlanningService } from './planning-domain';
import type { PlanningSearchCandidate, PlanningSearchInput } from './search';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class CrossWorkspaceSearchRepository extends InMemoryPlanningRepository {
  override async searchCandidates(
    _workspaceId: string,
    _input: PlanningSearchInput,
  ): Promise<PlanningSearchCandidate[]> {
    return [
      {
        entityType: 'goal',
        id: '22222222-2222-4222-8222-222222222222',
        workspaceId: 'other-workspace',
        title: 'Private launch plan',
        createdAt: '2026-08-04T01:00:00.000Z',
      },
    ];
  }
}

describe('PlanningService', () => {
  it('creates a Goal → Project → Task hierarchy inside one workspace', async () => {
    const service = new PlanningService(new InMemoryPlanningRepository());

    const goal = await service.createGoal('workspace-a', {
      title: 'Publish LifeOS',
    });
    const project = await service.createProject('workspace-a', {
      goalId: goal.id,
      title: 'Planning MVP',
    });
    const task = await service.createTask('workspace-a', {
      projectId: project.id,
      title: 'Implement tenant isolation',
    });

    await expect(service.listGoals('workspace-a')).resolves.toEqual([goal]);
    await expect(service.listProjects('workspace-a', goal.id)).resolves.toEqual(
      [project],
    );
    await expect(service.listTasks('workspace-a', project.id)).resolves.toEqual(
      [task],
    );
  });

  it('generates opaque UUIDv4 identifiers instead of numeric or sequential IDs', async () => {
    const service = new PlanningService(new InMemoryPlanningRepository());
    const goal = await service.createGoal('workspace-a', {
      title: 'Opaque identifiers',
    });
    const project = await service.createProject('workspace-a', {
      goalId: goal.id,
      title: 'Project',
    });
    const task = await service.createTask('workspace-a', {
      projectId: project.id,
      title: 'Task',
    });

    for (const id of [goal.id, project.id, task.id]) {
      expect(id).toMatch(UUID_V4_PATTERN);
      expect(id).not.toMatch(/^\d+$/);
    }
  });

  it('rejects numeric-only workspace identifiers', async () => {
    const service = new PlanningService(new InMemoryPlanningRepository());

    await expect(
      service.createGoal('123456', { title: 'Unsafe tenant ID' }),
    ).rejects.toThrowError('Identifier must be an opaque non-numeric string');
  });

  it('does not expose records from another workspace', async () => {
    const service = new PlanningService(new InMemoryPlanningRepository());

    await service.createGoal('workspace-a', { title: 'Private goal' });

    await expect(service.listGoals('workspace-b')).resolves.toEqual([]);
    await expect(service.search('workspace-b', 'private')).resolves.toEqual([]);
  });

  it('rejects a project whose goal belongs to another workspace', async () => {
    const service = new PlanningService(new InMemoryPlanningRepository());
    const goal = await service.createGoal('workspace-a', {
      title: 'Workspace A goal',
    });

    await expect(
      service.createProject('workspace-b', {
        goalId: goal.id,
        title: 'Cross-tenant project',
      }),
    ).rejects.toThrowError('Goal not found');
  });

  it('rejects blank titles', async () => {
    const service = new PlanningService(new InMemoryPlanningRepository());

    await expect(
      service.createGoal('workspace-a', { title: '   ' }),
    ).rejects.toThrowError('Title is required');
  });

  it('searches goals, projects, and tasks with deterministic public results', async () => {
    const service = new PlanningService(new InMemoryPlanningRepository());
    const goal = await service.createGoal('workspace-a', {
      title: 'Launch Plan',
    });
    const project = await service.createProject('workspace-a', {
      goalId: goal.id,
      title: 'Launch plan execution',
    });
    const task = await service.createTask('workspace-a', {
      projectId: project.id,
      title: 'Draft the launch plan',
    });

    await expect(service.search('workspace-a', 'launch plan')).resolves.toEqual(
      [
        {
          entityType: 'goal',
          id: goal.id,
          title: goal.title,
          createdAt: goal.createdAt,
        },
        {
          entityType: 'project',
          id: project.id,
          parentId: goal.id,
          title: project.title,
          createdAt: project.createdAt,
        },
        {
          entityType: 'task',
          id: task.id,
          parentId: project.id,
          title: task.title,
          status: task.status,
          createdAt: task.createdAt,
        },
      ],
    );
  });

  it('rejects invalid queries before repository search', async () => {
    const service = new PlanningService(new InMemoryPlanningRepository());

    await expect(service.search('workspace-a', '1')).rejects.toThrowError(
      'Planning search request is invalid',
    );
  });

  it('fails closed if a repository returns a cross-workspace candidate', async () => {
    const service = new PlanningService(new CrossWorkspaceSearchRepository());

    await expect(service.search('workspace-a', 'private')).rejects.toThrowError(
      'Planning search crossed workspace boundary',
    );
  });
});
