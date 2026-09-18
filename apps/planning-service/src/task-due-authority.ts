import type {
  TaskDueAuthorityRepository,
  TaskWithDueAuthority,
} from './planning-domain';
import {
  PlanningPersistenceError,
  PostgresPlanningRepository,
} from './postgres-planning-repository';
import type { TodayTransactionalSqlClient } from './postgres-today-repository';

interface TaskDueRow {
  id: unknown;
  due_at: unknown;
}

/** Rejects malformed durable deadline evidence without reflecting its contents. */
function invalidDueAuthority(): never {
  throw new PlanningPersistenceError();
}

/** Converts one persisted PostgreSQL deadline instant to canonical UTC form. */
function parsePersistedDueAt(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  const parsed =
    value instanceof Date
      ? value
      : typeof value === 'string'
        ? new Date(value)
        : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return invalidDueAuthority();
  }
  return parsed.toISOString();
}

/** Requires one update/read row to match the already validated task identity. */
function requireDueRow(
  row: TaskDueRow | undefined,
  expectedTaskId: string,
): string | null {
  if (!row || row.id !== expectedTaskId) {
    return invalidDueAuthority();
  }
  return parsePersistedDueAt(row.due_at);
}

/**
 * Adds durable task deadline authority without duplicating the canonical task
 * parser. Base task validation stays in PostgresPlanningRepository; the deadline
 * column is mutated in the same short transaction as task creation and joined
 * fail-closed to validated base rows on reads.
 */
export class PostgresTaskDueAuthorityRepository
  implements TaskDueAuthorityRepository
{
  /** Creates the adapter over the Planning-owned transaction-capable SQL client. */
  constructor(private readonly client: TodayTransactionalSqlClient) {}

  /** Persists a validated task and its nullable deadline atomically. */
  async saveTask(task: TaskWithDueAuthority): Promise<void> {
    await this.client.transaction(async (transaction) => {
      await new PostgresPlanningRepository(transaction).saveTask(task);
      const result = await transaction.query<TaskDueRow>(
        `UPDATE planning.tasks
         SET due_at = $3::timestamptz
         WHERE workspace_id = $1::uuid AND id = $2::uuid
         RETURNING id, due_at`,
        [task.workspaceId, task.id, task.dueAt],
      );
      if (result.rows.length !== 1) {
        return invalidDueAuthority();
      }
      const persistedDueAt = requireDueRow(result.rows[0], task.id);
      if (persistedDueAt !== task.dueAt) {
        return invalidDueAuthority();
      }
    });
  }

  /** Lists deadline-bearing tasks while preserving canonical base-row validation. */
  async listTasks(
    workspaceId: string,
    projectId: string,
  ): Promise<TaskWithDueAuthority[]> {
    return await this.client.transaction(async (transaction) => {
      const tasks = await new PostgresPlanningRepository(transaction).listTasks(
        workspaceId,
        projectId,
      );
      const result = await transaction.query<TaskDueRow>(
        `SELECT id, due_at
         FROM planning.tasks
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid
         ORDER BY created_at ASC, id ASC`,
        [workspaceId, projectId],
      );
      if (result.rows.length !== tasks.length) {
        return invalidDueAuthority();
      }

      const dueByTaskId = new Map<string, string | null>();
      for (const row of result.rows) {
        if (typeof row.id !== 'string' || dueByTaskId.has(row.id)) {
          return invalidDueAuthority();
        }
        dueByTaskId.set(row.id, parsePersistedDueAt(row.due_at));
      }

      return tasks.map((task) => {
        if (!dueByTaskId.has(task.id)) {
          return invalidDueAuthority();
        }
        return {
          ...task,
          dueAt: dueByTaskId.get(task.id) ?? null,
        };
      });
    });
  }
}
