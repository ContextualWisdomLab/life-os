import { describe, expect, it } from 'vitest';
import {
  PostgresTaskCompletionRepository,
  TaskCompletionPersistenceError,
  type TaskCompletionRepository,
  type TaskCompletionTransition,
  TaskCompletionService,
  type TaskCompletionSqlClient,
  type TaskCompletionSqlQueryResult,
} from './task-completion';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const COMPLETED_AT = '2026-09-10T16:00:00.000Z';

class RecordingCompletionRepository implements TaskCompletionRepository {
  readonly calls: Array<{
    workspaceId: string;
    taskId: string;
    transition: TaskCompletionTransition;
  }> = [];

  constructor(private readonly exists = true) {}

  async transitionTaskCompletion(
    workspaceId: string,
    taskId: string,
    transition: TaskCompletionTransition,
  ) {
    this.calls.push({ workspaceId, taskId, transition });
    if (!this.exists) return undefined;
    return {
      workspaceId,
      taskId,
      status: transition.status,
      completedAt: transition.completedAt,
    };
  }
}

interface QueryCall {
  text: string;
  values: readonly unknown[];
}

class RecordingSqlClient implements TaskCompletionSqlClient {
  readonly calls: QueryCall[] = [];

  constructor(private readonly rows: unknown[]) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<TaskCompletionSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return { rows: this.rows as Row[] };
  }
}

describe('TaskCompletionService', () => {
  it('captures a server-owned completion instant and delegates one atomic mutation', async () => {
    const repository = new RecordingCompletionRepository();
    const service = new TaskCompletionService(
      repository,
      () => new Date(COMPLETED_AT),
    );

    await expect(
      service.setCompleted(WORKSPACE_ID, TASK_ID, true),
    ).resolves.toEqual({
      workspaceId: WORKSPACE_ID,
      taskId: TASK_ID,
      status: 'done',
      completedAt: COMPLETED_AT,
    });
    expect(repository.calls).toEqual([
      {
        workspaceId: WORKSPACE_ID,
        taskId: TASK_ID,
        transition: { status: 'done', completedAt: COMPLETED_AT },
      },
    ]);
  });

  it('reopens a task by clearing completion evidence in the same mutation', async () => {
    const repository = new RecordingCompletionRepository();
    const service = new TaskCompletionService(repository);

    await expect(
      service.setCompleted(WORKSPACE_ID, TASK_ID, false),
    ).resolves.toEqual({
      workspaceId: WORKSPACE_ID,
      taskId: TASK_ID,
      status: 'todo',
      completedAt: null,
    });
    expect(repository.calls[0]?.transition).toEqual({
      status: 'todo',
      completedAt: null,
    });
  });

  it('does not disclose whether a missing task belongs to another workspace', async () => {
    const service = new TaskCompletionService(
      new RecordingCompletionRepository(false),
    );

    await expect(
      service.setCompleted(WORKSPACE_ID, TASK_ID, true),
    ).rejects.toThrowError('Task not found');
  });

  it('rejects malformed identifiers before persistence', async () => {
    const repository = new RecordingCompletionRepository();
    const service = new TaskCompletionService(repository);

    await expect(
      service.setCompleted('workspace-a', TASK_ID, true),
    ).rejects.toThrowError('Task completion request is invalid');
    await expect(
      service.setCompleted(WORKSPACE_ID, 'task-1', true),
    ).rejects.toThrowError('Task completion request is invalid');
    expect(repository.calls).toEqual([]);
  });

  it('rejects a non-finite completion clock before persistence', async () => {
    const repository = new RecordingCompletionRepository();
    const service = new TaskCompletionService(repository, () => new Date(NaN));

    await expect(
      service.setCompleted(WORKSPACE_ID, TASK_ID, true),
    ).rejects.toThrowError('Task completion request is invalid');
    expect(repository.calls).toEqual([]);
  });
});

describe('PostgresTaskCompletionRepository', () => {
  it('updates status and completed_at atomically inside one tenant-scoped statement', async () => {
    const client = new RecordingSqlClient([
      {
        workspace_id: WORKSPACE_ID,
        id: TASK_ID,
        status: 'done',
        completed_at: COMPLETED_AT,
      },
    ]);
    const repository = new PostgresTaskCompletionRepository(client);

    await expect(
      repository.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, {
        status: 'done',
        completedAt: COMPLETED_AT,
      }),
    ).resolves.toEqual({
      workspaceId: WORKSPACE_ID,
      taskId: TASK_ID,
      status: 'done',
      completedAt: COMPLETED_AT,
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain('UPDATE planning.tasks');
    expect(client.calls[0]?.text).toContain(
      'SET status = $3, completed_at = $4',
    );
    expect(client.calls[0]?.text).toContain(
      'WHERE workspace_id = $1 AND id = $2',
    );
    expect(client.calls[0]?.text).toContain(
      'RETURNING workspace_id, id, status, completed_at',
    );
    expect(client.calls[0]?.values).toEqual([
      WORKSPACE_ID,
      TASK_ID,
      'done',
      COMPLETED_AT,
    ]);
  });

  it('returns undefined when the tenant-scoped update matches no task', async () => {
    const repository = new PostgresTaskCompletionRepository(
      new RecordingSqlClient([]),
    );

    await expect(
      repository.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, {
        status: 'todo',
        completedAt: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('fails closed on cross-workspace or contradictory returned evidence', async () => {
    const crossWorkspace = new PostgresTaskCompletionRepository(
      new RecordingSqlClient([
        {
          workspace_id: OTHER_WORKSPACE_ID,
          id: TASK_ID,
          status: 'done',
          completed_at: COMPLETED_AT,
        },
      ]),
    );
    await expect(
      crossWorkspace.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, {
        status: 'done',
        completedAt: COMPLETED_AT,
      }),
    ).rejects.toBeInstanceOf(TaskCompletionPersistenceError);

    const contradictory = new PostgresTaskCompletionRepository(
      new RecordingSqlClient([
        {
          workspace_id: WORKSPACE_ID,
          id: TASK_ID,
          status: 'todo',
          completed_at: COMPLETED_AT,
        },
      ]),
    );
    await expect(
      contradictory.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, {
        status: 'todo',
        completedAt: null,
      }),
    ).rejects.toBeInstanceOf(TaskCompletionPersistenceError);
  });

  it('fails closed if an update unexpectedly returns duplicate task identities', async () => {
    const row = {
      workspace_id: WORKSPACE_ID,
      id: TASK_ID,
      status: 'done',
      completed_at: COMPLETED_AT,
    };
    const repository = new PostgresTaskCompletionRepository(
      new RecordingSqlClient([row, row]),
    );

    await expect(
      repository.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, {
        status: 'done',
        completedAt: COMPLETED_AT,
      }),
    ).rejects.toBeInstanceOf(TaskCompletionPersistenceError);
  });
});
