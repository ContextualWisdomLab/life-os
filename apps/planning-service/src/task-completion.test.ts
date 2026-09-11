import { describe, expect, it } from 'vitest';
import {
  PostgresTaskCompletionRepository,
  TaskCompletionPersistenceError,
  type TaskCompletionEvidence,
  type TaskCompletionRepository,
  type TaskCompletionTransition,
  TaskCompletionService,
  type TaskCompletionSqlClient,
  type TaskCompletionSqlQueryResult,
} from './task-completion';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_TASK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FIRST_COMPLETED_AT = '2026-09-10T15:59:00.000Z';
const COMPLETED_AT = '2026-09-10T16:00:00.000Z';

type CompletionEvidenceOverride = Omit<
  Partial<TaskCompletionEvidence>,
  'completedAt'
> & {
  completedAt?: unknown;
};

class RecordingCompletionRepository implements TaskCompletionRepository {
  readonly calls: Array<{
    workspaceId: string;
    taskId: string;
    transition: TaskCompletionTransition;
  }> = [];

  constructor(
    private readonly exists = true,
    private readonly evidenceOverride?: CompletionEvidenceOverride,
  ) {}

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
      ...this.evidenceOverride,
    } as TaskCompletionEvidence;
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

  it.each([
    ['workspace identity', { workspaceId: OTHER_WORKSPACE_ID }],
    ['task identity', { taskId: OTHER_TASK_ID }],
    ['durable status', { status: 'todo' as const, completedAt: null }],
  ])('fails closed when persistence distorts %s', async (_name, override) => {
    const service = new TaskCompletionService(
      new RecordingCompletionRepository(true, override),
      () => new Date(COMPLETED_AT),
    );

    await expect(
      service.setCompleted(WORKSPACE_ID, TASK_ID, true),
    ).rejects.toBeInstanceOf(TaskCompletionPersistenceError);
  });

  it.each([
    ['non-canonical Date evidence', new Date(COMPLETED_AT)],
    ['invalid timestamp evidence', 'not-an-instant'],
  ])('fails closed on %s', async (_name, completedAt) => {
    const service = new TaskCompletionService(
      new RecordingCompletionRepository(true, { completedAt }),
      () => new Date(COMPLETED_AT),
    );

    await expect(
      service.setCompleted(WORKSPACE_ID, TASK_ID, true),
    ).rejects.toBeInstanceOf(TaskCompletionPersistenceError);
  });

  it('fails closed if reopened persistence evidence retains a completion instant', async () => {
    const service = new TaskCompletionService(
      new RecordingCompletionRepository(true, { completedAt: COMPLETED_AT }),
    );

    await expect(
      service.setCompleted(WORKSPACE_ID, TASK_ID, false),
    ).rejects.toBeInstanceOf(TaskCompletionPersistenceError);
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
        previous_status: 'todo',
        completion_fact_count: 1,
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
    expect(client.calls[0]?.text).toContain('SET status = $3');
    expect(client.calls[0]?.text).toContain('completed_at =');
    expect(client.calls[0]?.text).toContain(
      'WHERE workspace_id = $1 AND id = $2',
    );
    expect(client.calls[0]?.text).toContain(
      'RETURNING workspace_id, id, status, completed_at',
    );
    expect(client.calls[0]?.text).toContain(
      'previous.previous_status AS previous_status',
    );
    expect(client.calls[0]?.text).toContain('AS completion_fact_count');
    expect(client.calls[0]?.text).toContain(
      'INSERT INTO planning.task_completion_facts',
    );
    const boundValues = client.calls[0]?.values;
    expect(boundValues?.slice(0, 4)).toEqual([
      WORKSPACE_ID,
      TASK_ID,
      'done',
      COMPLETED_AT,
    ]);
    expect(boundValues).toHaveLength(5);
    expect(boundValues?.[4]).toEqual(
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    );
  });

  it('preserves the first completion instant when a completed request is retried', async () => {
    const client = new RecordingSqlClient([
      {
        workspace_id: WORKSPACE_ID,
        id: TASK_ID,
        status: 'done',
        completed_at: FIRST_COMPLETED_AT,
        previous_status: 'done',
        completion_fact_count: 0,
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
      completedAt: FIRST_COMPLETED_AT,
    });
    expect(client.calls[0]?.text).toContain(
      "WHEN $3 = 'done' AND status = 'done' AND completed_at IS NOT NULL",
    );
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

  it.each([
    [
      'invalid workspace UUID',
      {
        workspace_id: 'workspace-a',
        id: TASK_ID,
        status: 'done',
        completed_at: COMPLETED_AT,
      },
    ],
    [
      'invalid task UUID',
      {
        workspace_id: WORKSPACE_ID,
        id: 'task-1',
        status: 'done',
        completed_at: COMPLETED_AT,
      },
    ],
    [
      'unsupported status',
      {
        workspace_id: WORKSPACE_ID,
        id: TASK_ID,
        status: 'archived',
        completed_at: COMPLETED_AT,
      },
    ],
    [
      'invalid completion timestamp',
      {
        workspace_id: WORKSPACE_ID,
        id: TASK_ID,
        status: 'done',
        completed_at: 'not-an-instant',
      },
    ],
    [
      'invalid Date completion timestamp',
      {
        workspace_id: WORKSPACE_ID,
        id: TASK_ID,
        status: 'done',
        completed_at: new Date(NaN),
      },
    ],
  ])('fails closed on %s returned by PostgreSQL', async (_name, row) => {
    const repository = new PostgresTaskCompletionRepository(
      new RecordingSqlClient([row]),
    );

    await expect(
      repository.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, {
        status: 'done',
        completedAt: COMPLETED_AT,
      }),
    ).rejects.toBeInstanceOf(TaskCompletionPersistenceError);
  });

  it('fails closed when atomic acceptance evidence columns are missing', async () => {
    const repository = new PostgresTaskCompletionRepository(
      new RecordingSqlClient([
        {
          workspace_id: WORKSPACE_ID,
          id: TASK_ID,
          status: 'done',
          completed_at: COMPLETED_AT,
        },
      ]),
    );

    await expect(
      repository.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, {
        status: 'done',
        completedAt: COMPLETED_AT,
      }),
    ).rejects.toBeInstanceOf(TaskCompletionPersistenceError);
  });

  it('fails closed when persistence reports no fact for a new completion', async () => {
    const repository = new PostgresTaskCompletionRepository(
      new RecordingSqlClient([
        {
          workspace_id: WORKSPACE_ID,
          id: TASK_ID,
          status: 'done',
          completed_at: COMPLETED_AT,
          previous_status: 'todo',
          completion_fact_count: 0,
        },
      ]),
    );

    await expect(
      repository.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, {
        status: 'done',
        completedAt: COMPLETED_AT,
      }),
    ).rejects.toBeInstanceOf(TaskCompletionPersistenceError);
  });

  it.each([
    [
      'a completed retry that appends a fact',
      'done',
      FIRST_COMPLETED_AT,
      'done',
      1,
    ],
    ['a reopen that appends a fact', 'todo', null, 'done', 1],
    ['an unknown prior state', 'done', COMPLETED_AT, 'archived', 1],
    ['an invalid completion fact count', 'done', COMPLETED_AT, 'todo', 2],
  ] as const)(
    'fails closed on %s',
    async (_name, status, completedAt, previousStatus, completionFactCount) => {
      const repository = new PostgresTaskCompletionRepository(
        new RecordingSqlClient([
          {
            workspace_id: WORKSPACE_ID,
            id: TASK_ID,
            status,
            completed_at: completedAt,
            previous_status: previousStatus,
            completion_fact_count: completionFactCount,
          },
        ]),
      );
      const transition: TaskCompletionTransition =
        status === 'done'
          ? { status: 'done', completedAt: COMPLETED_AT }
          : { status: 'todo', completedAt: null };

      await expect(
        repository.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, transition),
      ).rejects.toBeInstanceOf(TaskCompletionPersistenceError);
    },
  );

  it('canonicalizes a valid Date returned by the PostgreSQL driver', async () => {
    const repository = new PostgresTaskCompletionRepository(
      new RecordingSqlClient([
        {
          workspace_id: WORKSPACE_ID,
          id: TASK_ID,
          status: 'done',
          completed_at: new Date(COMPLETED_AT),
          previous_status: 'todo',
          completion_fact_count: 1,
        },
      ]),
    );

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
