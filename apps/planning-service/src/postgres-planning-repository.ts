import type {
  Goal,
  PlanningRepository,
  Project,
  Task,
} from './planning-domain';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVALID_STORED_GOAL = 'Stored planning goal is invalid';
const INVALID_STORED_PROJECT = 'Stored planning project is invalid';
const INVALID_STORED_TASK = 'Stored planning task is invalid';

export interface PlanningQueryResult<Row> {
  rows: Row[];
}

export interface PlanningSqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PlanningQueryResult<Row>>;
}

interface GoalRow {
  id: unknown;
  workspace_id: unknown;
  title: unknown;
  created_at: unknown;
}

interface ProjectRow extends GoalRow {
  goal_id: unknown;
  goal_workspace_id: unknown;
}

interface TaskRow extends GoalRow {
  project_id: unknown;
  project_workspace_id: unknown;
  status: unknown;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(message);
  }
  return value;
}

function requireUuidV4(value: unknown, message: string): string {
  const identifier = requireString(value, message);
  if (!UUID_V4_PATTERN.test(identifier)) {
    throw new Error(message);
  }
  return identifier;
}

function requireTimestamp(value: unknown, message: string): string {
  const timestamp =
    value instanceof Date ? value : new Date(requireString(value, message));
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(message);
  }
  return timestamp.toISOString();
}

function requireTaskStatus(value: unknown): Task['status'] {
  if (value !== 'todo' && value !== 'done') {
    throw new Error(INVALID_STORED_TASK);
  }
  return value;
}

function mapGoalRow(row: GoalRow): Goal {
  return {
    id: requireUuidV4(row.id, INVALID_STORED_GOAL),
    workspaceId: requireUuidV4(row.workspace_id, INVALID_STORED_GOAL),
    title: requireString(row.title, INVALID_STORED_GOAL),
    createdAt: requireTimestamp(row.created_at, INVALID_STORED_GOAL),
  };
}

function mapProjectRow(row: ProjectRow): Project {
  const workspaceId = requireUuidV4(row.workspace_id, INVALID_STORED_PROJECT);
  const goalWorkspaceId = requireUuidV4(
    row.goal_workspace_id,
    INVALID_STORED_PROJECT,
  );
  if (goalWorkspaceId !== workspaceId) {
    throw new Error(INVALID_STORED_PROJECT);
  }
  return {
    id: requireUuidV4(row.id, INVALID_STORED_PROJECT),
    workspaceId,
    goalId: requireUuidV4(row.goal_id, INVALID_STORED_PROJECT),
    title: requireString(row.title, INVALID_STORED_PROJECT),
    createdAt: requireTimestamp(row.created_at, INVALID_STORED_PROJECT),
  };
}

function mapTaskRow(row: TaskRow): Task {
  const workspaceId = requireUuidV4(row.workspace_id, INVALID_STORED_TASK);
  const projectWorkspaceId = requireUuidV4(
    row.project_workspace_id,
    INVALID_STORED_TASK,
  );
  if (projectWorkspaceId !== workspaceId) {
    throw new Error(INVALID_STORED_TASK);
  }
  return {
    id: requireUuidV4(row.id, INVALID_STORED_TASK),
    workspaceId,
    projectId: requireUuidV4(row.project_id, INVALID_STORED_TASK),
    title: requireString(row.title, INVALID_STORED_TASK),
    status: requireTaskStatus(row.status),
    createdAt: requireTimestamp(row.created_at, INVALID_STORED_TASK),
  };
}

function requireAtMostOne<Row>(rows: Row[], message: string): Row | undefined {
  if (rows.length > 1) {
    throw new Error(message);
  }
  return rows[0];
}

function validateGoal(goal: Goal): Goal {
  return mapGoalRow({
    id: goal.id,
    workspace_id: goal.workspaceId,
    title: goal.title,
    created_at: goal.createdAt,
  });
}

function validateProject(project: Project): Project {
  return mapProjectRow({
    id: project.id,
    workspace_id: project.workspaceId,
    goal_id: project.goalId,
    goal_workspace_id: project.workspaceId,
    title: project.title,
    created_at: project.createdAt,
  });
}

function validateTask(task: Task): Task {
  return mapTaskRow({
    id: task.id,
    workspace_id: task.workspaceId,
    project_id: task.projectId,
    project_workspace_id: task.workspaceId,
    title: task.title,
    status: task.status,
    created_at: task.createdAt,
  });
}

export class PostgresPlanningRepository implements PlanningRepository {
  constructor(private readonly database: PlanningSqlClient) {}

  async saveGoal(goalValue: Goal): Promise<void> {
    const goal = validateGoal(goalValue);
    await this.database.query(
      `INSERT INTO planning.goals (id, workspace_id, title, created_at)
       VALUES ($1, $2, $3, $4)`,
      [goal.id, goal.workspaceId, goal.title, goal.createdAt],
    );
  }

  async saveProject(projectValue: Project): Promise<void> {
    const project = validateProject(projectValue);
    await this.database.query(
      `INSERT INTO planning.projects (
         id,
         workspace_id,
         goal_id,
         title,
         created_at
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        project.id,
        project.workspaceId,
        project.goalId,
        project.title,
        project.createdAt,
      ],
    );
  }

  async saveTask(taskValue: Task): Promise<void> {
    const task = validateTask(taskValue);
    await this.database.query(
      `INSERT INTO planning.tasks (
         id,
         workspace_id,
         project_id,
         title,
         status,
         created_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        task.id,
        task.workspaceId,
        task.projectId,
        task.title,
        task.status,
        task.createdAt,
      ],
    );
  }

  async findGoal(workspaceId: string, id: string): Promise<Goal | undefined> {
    const result = await this.database.query<GoalRow>(
      `SELECT id, workspace_id, title, created_at
       FROM planning.goals
       WHERE workspace_id = $1
         AND id = $2
       LIMIT 2`,
      [workspaceId, id],
    );
    const row = requireAtMostOne(result.rows, INVALID_STORED_GOAL);
    return row ? mapGoalRow(row) : undefined;
  }

  async findProject(
    workspaceId: string,
    id: string,
  ): Promise<Project | undefined> {
    const result = await this.database.query<ProjectRow>(
      `SELECT
         projects.id,
         projects.workspace_id,
         projects.goal_id,
         goals.workspace_id AS goal_workspace_id,
         projects.title,
         projects.created_at
       FROM planning.projects
       JOIN planning.goals
         ON planning.goals.id = planning.projects.goal_id
        AND planning.goals.workspace_id = planning.projects.workspace_id
       WHERE planning.projects.workspace_id = $1
         AND planning.projects.id = $2
       LIMIT 2`,
      [workspaceId, id],
    );
    const row = requireAtMostOne(result.rows, INVALID_STORED_PROJECT);
    return row ? mapProjectRow(row) : undefined;
  }

  async listGoals(workspaceId: string): Promise<Goal[]> {
    const result = await this.database.query<GoalRow>(
      `SELECT id, workspace_id, title, created_at
       FROM planning.goals
       WHERE workspace_id = $1
       ORDER BY created_at ASC, id ASC`,
      [workspaceId],
    );
    return result.rows.map(mapGoalRow);
  }

  async listProjects(workspaceId: string, goalId: string): Promise<Project[]> {
    const result = await this.database.query<ProjectRow>(
      `SELECT
         projects.id,
         projects.workspace_id,
         projects.goal_id,
         goals.workspace_id AS goal_workspace_id,
         projects.title,
         projects.created_at
       FROM planning.projects
       JOIN planning.goals
         ON planning.goals.id = planning.projects.goal_id
        AND planning.goals.workspace_id = planning.projects.workspace_id
       WHERE planning.projects.workspace_id = $1
         AND planning.projects.goal_id = $2
       ORDER BY planning.projects.created_at ASC, planning.projects.id ASC`,
      [workspaceId, goalId],
    );
    return result.rows.map(mapProjectRow);
  }

  async listTasks(workspaceId: string, projectId: string): Promise<Task[]> {
    const result = await this.database.query<TaskRow>(
      `SELECT
         tasks.id,
         tasks.workspace_id,
         tasks.project_id,
         projects.workspace_id AS project_workspace_id,
         tasks.title,
         tasks.status,
         tasks.created_at
       FROM planning.tasks
       JOIN planning.projects
         ON planning.projects.id = planning.tasks.project_id
        AND planning.projects.workspace_id = planning.tasks.workspace_id
       WHERE planning.tasks.workspace_id = $1
         AND planning.tasks.project_id = $2
       ORDER BY planning.tasks.created_at ASC, planning.tasks.id ASC`,
      [workspaceId, projectId],
    );
    return result.rows.map(mapTaskRow);
  }
}
