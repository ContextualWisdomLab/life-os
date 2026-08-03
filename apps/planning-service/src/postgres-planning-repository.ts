import type {
  Goal,
  PlanningRepository,
  Project,
  Task,
} from './planning-domain';

export interface PlanningSqlQueryResult<Row> {
  rows: Row[];
}

export interface PlanningSqlClient {
  query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PlanningSqlQueryResult<Row>>;
}

interface GoalRow {
  id: unknown;
  workspace_id: unknown;
  title: unknown;
  created_at: unknown;
}

interface ProjectRow extends GoalRow {
  goal_id: unknown;
}

interface TaskRow extends GoalRow {
  project_id: unknown;
  status: unknown;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PlanningPersistenceError extends Error {
  constructor() {
    super('Persisted planning data is invalid');
    this.name = 'PlanningPersistenceError';
  }
}

function invalidRow(): never {
  throw new PlanningPersistenceError();
}

function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidRow();
  }
  return value.toLowerCase();
}

function requireTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return invalidRow();
  }
  return value;
}

function requireTimestamp(value: unknown): string {
  if (!(typeof value === 'string' || value instanceof Date)) {
    return invalidRow();
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return invalidRow();
  }
  return parsed.toISOString();
}

function requireStatus(value: unknown): Task['status'] {
  if (value !== 'todo' && value !== 'done') {
    return invalidRow();
  }
  return value;
}

function requireExpected(actual: string, expected: string): void {
  if (actual !== expected.toLowerCase()) {
    invalidRow();
  }
}

function parseGoal(row: GoalRow, expectedWorkspaceId?: string): Goal {
  const goal: Goal = {
    id: requireUuidV4(row.id),
    workspaceId: requireUuidV4(row.workspace_id),
    title: requireTitle(row.title),
    createdAt: requireTimestamp(row.created_at),
  };
  if (expectedWorkspaceId) {
    requireExpected(goal.workspaceId, expectedWorkspaceId);
  }
  return goal;
}

function parseProject(
  row: ProjectRow,
  expectedWorkspaceId?: string,
  expectedGoalId?: string,
): Project {
  const project: Project = {
    ...parseGoal(row, expectedWorkspaceId),
    goalId: requireUuidV4(row.goal_id),
  };
  if (expectedGoalId) {
    requireExpected(project.goalId, expectedGoalId);
  }
  return project;
}

function parseTask(
  row: TaskRow,
  expectedWorkspaceId?: string,
  expectedProjectId?: string,
): Task {
  const task: Task = {
    ...parseGoal(row, expectedWorkspaceId),
    projectId: requireUuidV4(row.project_id),
    status: requireStatus(row.status),
  };
  if (expectedProjectId) {
    requireExpected(task.projectId, expectedProjectId);
  }
  return task;
}

function validateGoal(goal: Goal): Goal {
  return parseGoal({
    id: goal.id,
    workspace_id: goal.workspaceId,
    title: goal.title,
    created_at: goal.createdAt,
  });
}

function validateProject(project: Project): Project {
  return parseProject({
    id: project.id,
    workspace_id: project.workspaceId,
    goal_id: project.goalId,
    title: project.title,
    created_at: project.createdAt,
  });
}

function validateTask(task: Task): Task {
  return parseTask({
    id: task.id,
    workspace_id: task.workspaceId,
    project_id: task.projectId,
    title: task.title,
    status: task.status,
    created_at: task.createdAt,
  });
}

function oneOrUndefined<Row>(rows: Row[]): Row | undefined {
  if (rows.length > 1) {
    invalidRow();
  }
  return rows[0];
}

export class PostgresPlanningRepository implements PlanningRepository {
  constructor(private readonly client: PlanningSqlClient) {}

  async saveGoal(goal: Goal): Promise<void> {
    const safe = validateGoal(goal);
    await this.client.query(
      `INSERT INTO planning.goals
        (id, workspace_id, title, created_at)
       VALUES ($1, $2, $3, $4)`,
      [safe.id, safe.workspaceId, safe.title, safe.createdAt],
    );
  }

  async saveProject(project: Project): Promise<void> {
    const safe = validateProject(project);
    await this.client.query(
      `INSERT INTO planning.projects
        (id, workspace_id, goal_id, title, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        safe.id,
        safe.workspaceId,
        safe.goalId,
        safe.title,
        safe.createdAt,
      ],
    );
  }

  async saveTask(task: Task): Promise<void> {
    const safe = validateTask(task);
    await this.client.query(
      `INSERT INTO planning.tasks
        (id, workspace_id, project_id, title, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        safe.id,
        safe.workspaceId,
        safe.projectId,
        safe.title,
        safe.status,
        safe.createdAt,
      ],
    );
  }

  async findGoal(
    workspaceId: string,
    id: string,
  ): Promise<Goal | undefined> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const safeId = requireUuidV4(id);
    const result = await this.client.query<GoalRow>(
      `SELECT id, workspace_id, title, created_at
       FROM planning.goals
       WHERE workspace_id = $1 AND id = $2
       LIMIT 2`,
      [safeWorkspaceId, safeId],
    );
    const row = oneOrUndefined(result.rows);
    return row ? parseGoal(row, safeWorkspaceId) : undefined;
  }

  async findProject(
    workspaceId: string,
    id: string,
  ): Promise<Project | undefined> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const safeId = requireUuidV4(id);
    const result = await this.client.query<ProjectRow>(
      `SELECT id, workspace_id, goal_id, title, created_at
       FROM planning.projects
       WHERE workspace_id = $1 AND id = $2
       LIMIT 2`,
      [safeWorkspaceId, safeId],
    );
    const row = oneOrUndefined(result.rows);
    return row ? parseProject(row, safeWorkspaceId) : undefined;
  }

  async listGoals(workspaceId: string): Promise<Goal[]> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const result = await this.client.query<GoalRow>(
      `SELECT id, workspace_id, title, created_at
       FROM planning.goals
       WHERE workspace_id = $1
       ORDER BY created_at ASC, id ASC`,
      [safeWorkspaceId],
    );
    return result.rows.map((row) => parseGoal(row, safeWorkspaceId));
  }

  async listProjects(
    workspaceId: string,
    goalId: string,
  ): Promise<Project[]> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const safeGoalId = requireUuidV4(goalId);
    const result = await this.client.query<ProjectRow>(
      `SELECT id, workspace_id, goal_id, title, created_at
       FROM planning.projects
       WHERE workspace_id = $1 AND goal_id = $2
       ORDER BY created_at ASC, id ASC`,
      [safeWorkspaceId, safeGoalId],
    );
    return result.rows.map((row) =>
      parseProject(row, safeWorkspaceId, safeGoalId),
    );
  }

  async listTasks(
    workspaceId: string,
    projectId: string,
  ): Promise<Task[]> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const safeProjectId = requireUuidV4(projectId);
    const result = await this.client.query<TaskRow>(
      `SELECT id, workspace_id, project_id, title, status, created_at
       FROM planning.tasks
       WHERE workspace_id = $1 AND project_id = $2
       ORDER BY created_at ASC, id ASC`,
      [safeWorkspaceId, safeProjectId],
    );
    return result.rows.map((row) =>
      parseTask(row, safeWorkspaceId, safeProjectId),
    );
  }
}
