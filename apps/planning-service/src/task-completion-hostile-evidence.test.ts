import { describe, expect, it } from 'vitest';
import {
  PostgresTaskCompletionRepository,
  TaskCompletionPersistenceError,
  type TaskCompletionEvidence,
  type TaskCompletionRepository,
  TaskCompletionService,
  type TaskCompletionSqlClient,
  type TaskCompletionSqlQueryResult,
} from './task-completion';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const COMPLETED_AT = '2026-09-10T16:00:00.000Z';

function revokedProxy<T extends object>(value: T): T {
  const { proxy, revoke } = Proxy.revocable(value, {});
  revoke();
  return proxy;
}

async function expectCredentialFreePersistenceFailure(
  operation: Promise<unknown>,
): Promise<void> {
  const error = await operation.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(TaskCompletionPersistenceError);
  expect(error).toMatchObject({
    message: 'Persisted task completion data is invalid',
  });
}

describe('task completion hostile persistence evidence', () => {
  it('collapses a rejected repository dependency without reflecting backend detail', async () => {
    const sentinel = 'password=must-not-escape-task-completion-dependency';
    const repository: TaskCompletionRepository = {
      async transitionTaskCompletion() {
        throw new Error(sentinel);
      },
    };
    const service = new TaskCompletionService(
      repository,
      () => new Date(COMPLETED_AT),
    );

    await expectCredentialFreePersistenceFailure(
      service.setCompleted(WORKSPACE_ID, TASK_ID, true),
    );
  });

  it('collapses revoked producer evidence before reading authority fields', async () => {
    const repository: TaskCompletionRepository = {
      async transitionTaskCompletion() {
        return revokedProxy({
          workspaceId: WORKSPACE_ID,
          taskId: TASK_ID,
          status: 'done' as const,
          completedAt: COMPLETED_AT,
        }) as TaskCompletionEvidence;
      },
    };
    const service = new TaskCompletionService(
      repository,
      () => new Date(COMPLETED_AT),
    );

    await expectCredentialFreePersistenceFailure(
      service.setCompleted(WORKSPACE_ID, TASK_ID, true),
    );
  });

  it('collapses a rejected SQL dependency without reflecting backend detail', async () => {
    const sentinel = 'postgres=must-not-escape-task-completion-dependency';
    const client: TaskCompletionSqlClient = {
      async query<Row>(): Promise<TaskCompletionSqlQueryResult<Row>> {
        throw new Error(sentinel);
      },
    };
    const repository = new PostgresTaskCompletionRepository(client);

    await expectCredentialFreePersistenceFailure(
      repository.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, {
        status: 'done',
        completedAt: COMPLETED_AT,
      }),
    );
  });

  it('collapses revoked SQL result envelopes before reading rows', async () => {
    const client: TaskCompletionSqlClient = {
      async query<Row>(): Promise<TaskCompletionSqlQueryResult<Row>> {
        return revokedProxy({ rows: [] }) as TaskCompletionSqlQueryResult<Row>;
      },
    };
    const repository = new PostgresTaskCompletionRepository(client);

    await expectCredentialFreePersistenceFailure(
      repository.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, {
        status: 'done',
        completedAt: COMPLETED_AT,
      }),
    );
  });

  it('collapses revoked SQL rows before reading durable authority fields', async () => {
    const row = revokedProxy({
      workspace_id: WORKSPACE_ID,
      id: TASK_ID,
      status: 'done',
      completed_at: COMPLETED_AT,
    });
    const client: TaskCompletionSqlClient = {
      async query<Row>(): Promise<TaskCompletionSqlQueryResult<Row>> {
        return { rows: [row as Row] };
      },
    };
    const repository = new PostgresTaskCompletionRepository(client);

    await expectCredentialFreePersistenceFailure(
      repository.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, {
        status: 'done',
        completedAt: COMPLETED_AT,
      }),
    );
  });
});
