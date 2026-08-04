import { randomUUID } from 'node:crypto';
import {
  matchesPlanningSearchTokens,
  rankPlanningSearchCandidates,
  requirePlanningSearchInput,
  type PlanningSearchCandidate,
  type PlanningSearchInput,
  type PlanningSearchResult,
} from './search';

/** Durable top-level outcome owned by one workspace. */
export interface Goal {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string;
}

/** Durable body of work nested below one workspace-owned goal. */
export interface Project {
  id: string;
  workspaceId: string;
  goalId: string;
  title: string;
  createdAt: string;
}

/** Durable actionable item nested below one workspace-owned project. */
export interface Task {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  status: 'todo' | 'done';
  createdAt: string;
}

/** Persistence boundary required by the tenant-safe planning domain service. */
export interface PlanningRepository {
  /** Persists one validated workspace-owned goal. */
  saveGoal(goal: Goal): Promise<void>;
  /** Persists one validated project whose parent belongs to the same workspace. */
  saveProject(project: Project): Promise<void>;
  /** Persists one validated task whose parent belongs to the same workspace. */
  saveTask(task: Task): Promise<void>;
  /** Finds one goal only when both workspace and opaque identifier match. */
  findGoal(workspaceId: string, id: string): Promise<Goal | undefined>;
  /** Finds one project only when both workspace and opaque identifier match. */
  findProject(workspaceId: string, id: string): Promise<Project | undefined>;
  /** Lists all goals visible inside one workspace. */
  listGoals(workspaceId: string): Promise<Goal[]>;
  /** Lists projects below a goal that belongs to the same workspace. */
  listProjects(workspaceId: string, goalId: string): Promise<Project[]>;
  /** Lists tasks below a project that belongs to the same workspace. */
  listTasks(workspaceId: string, projectId: string): Promise<Task[]>;
  /** Returns bounded candidates for deterministic application-level ranking. */
  searchCandidates(
    workspaceId: string,
    input: PlanningSearchInput,
  ): Promise<PlanningSearchCandidate[]>;
}

/** In-memory repository used only by deterministic domain tests and examples. */
export class InMemoryPlanningRepository implements PlanningRepository {
  private readonly goals = new Map<string, Goal>();
  private readonly projects = new Map<string, Project>();
  private readonly tasks = new Map<string, Task>();

  /** Stores a goal under its opaque identifier. */
  async saveGoal(goal: Goal): Promise<void> {
    this.goals.set(goal.id, goal);
  }

  /** Stores a project under its opaque identifier. */
  async saveProject(project: Project): Promise<void> {
    this.projects.set(project.id, project);
  }

  /** Stores a task under its opaque identifier. */
  async saveTask(task: Task): Promise<void> {
    this.tasks.set(task.id, task);
  }

  /** Returns a goal only when its stored workspace matches the caller scope. */
  async findGoal(workspaceId: string, id: string): Promise<Goal | undefined> {
    const goal = this.goals.get(id);
    return goal?.workspaceId === workspaceId ? goal : undefined;
  }

  /** Returns a project only when its stored workspace matches the caller scope. */
  async findProject(
    workspaceId: string,
    id: string,
  ): Promise<Project | undefined> {
    const project = this.projects.get(id);
    return project?.workspaceId === workspaceId ? project : undefined;
  }

  /** Lists goals without exposing records from another workspace. */
  async listGoals(workspaceId: string): Promise<Goal[]> {
    return [...this.goals.values()].filter(
      (goal) => goal.workspaceId === workspaceId,
    );
  }

  /** Lists projects whose workspace and parent goal both match the request. */
  async listProjects(workspaceId: string, goalId: string): Promise<Project[]> {
    return [...this.projects.values()].filter(
      (project) =>
        project.workspaceId === workspaceId && project.goalId === goalId,
    );
  }

  /** Lists tasks whose workspace and parent project both match the request. */
  async listTasks(workspaceId: string, projectId: string): Promise<Task[]> {
    return [...this.tasks.values()].filter(
      (task) =>
        task.workspaceId === workspaceId && task.projectId === projectId,
    );
  }

  /** Collects only whole-token matches inside the requested workspace. */
  async searchCandidates(
    workspaceId: string,
    input: PlanningSearchInput,
  ): Promise<PlanningSearchCandidate[]> {
    const candidates: PlanningSearchCandidate[] = [
      ...[...this.goals.values()].map((goal) => ({
        entityType: 'goal' as const,
        id: goal.id,
        workspaceId: goal.workspaceId,
        title: goal.title,
        createdAt: goal.createdAt,
      })),
      ...[...this.projects.values()].map((project) => ({
        entityType: 'project' as const,
        id: project.id,
        workspaceId: project.workspaceId,
        parentId: project.goalId,
        title: project.title,
        createdAt: project.createdAt,
      })),
      ...[...this.tasks.values()].map((task) => ({
        entityType: 'task' as const,
        id: task.id,
        workspaceId: task.workspaceId,
        parentId: task.projectId,
        title: task.title,
        status: task.status,
        createdAt: task.createdAt,
      })),
    ];
    return candidates.filter(
      (candidate) =>
        candidate.workspaceId === workspaceId &&
        matchesPlanningSearchTokens(candidate.title, input),
    );
  }
}

/** Trims a user-visible title and rejects blank values. */
function normalizeTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) {
    throw new Error('Title is required');
  }
  return normalized;
}

/** Requires a non-empty, non-numeric identifier at the domain boundary. */
function requireOpaqueId(value: string): string {
  const normalized = value.trim();
  if (!normalized || /^\d+$/.test(normalized)) {
    throw new Error('Identifier must be an opaque non-numeric string');
  }
  return normalized;
}

/** Creates an unpredictable UUIDv4 identifier for a new planning record. */
function createOpaqueId(): string {
  return randomUUID();
}

/** Coordinates tenant-owned planning mutations, reads, and unified search. */
export class PlanningService {
  /** Creates a domain service backed by the supplied persistence adapter. */
  constructor(private readonly repository: PlanningRepository) {}

  /** Creates and persists a goal in one validated workspace. */
  async createGoal(
    workspaceId: string,
    input: { title: string },
  ): Promise<Goal> {
    const safeWorkspaceId = requireOpaqueId(workspaceId);
    const goal: Goal = {
      id: createOpaqueId(),
      workspaceId: safeWorkspaceId,
      title: normalizeTitle(input.title),
      createdAt: new Date().toISOString(),
    };
    await this.repository.saveGoal(goal);
    return goal;
  }

  /** Creates a project only when its parent goal is visible in the workspace. */
  async createProject(
    workspaceId: string,
    input: { goalId: string; title: string },
  ): Promise<Project> {
    const safeWorkspaceId = requireOpaqueId(workspaceId);
    const safeGoalId = requireOpaqueId(input.goalId);
    if (!(await this.repository.findGoal(safeWorkspaceId, safeGoalId))) {
      throw new Error('Goal not found');
    }
    const project: Project = {
      id: createOpaqueId(),
      workspaceId: safeWorkspaceId,
      goalId: safeGoalId,
      title: normalizeTitle(input.title),
      createdAt: new Date().toISOString(),
    };
    await this.repository.saveProject(project);
    return project;
  }

  /** Creates a task only when its parent project is visible in the workspace. */
  async createTask(
    workspaceId: string,
    input: { projectId: string; title: string },
  ): Promise<Task> {
    const safeWorkspaceId = requireOpaqueId(workspaceId);
    const safeProjectId = requireOpaqueId(input.projectId);
    if (!(await this.repository.findProject(safeWorkspaceId, safeProjectId))) {
      throw new Error('Project not found');
    }
    const task: Task = {
      id: createOpaqueId(),
      workspaceId: safeWorkspaceId,
      projectId: safeProjectId,
      title: normalizeTitle(input.title),
      status: 'todo',
      createdAt: new Date().toISOString(),
    };
    await this.repository.saveTask(task);
    return task;
  }

  /** Lists goals visible in one validated workspace. */
  async listGoals(workspaceId: string): Promise<Goal[]> {
    return await this.repository.listGoals(requireOpaqueId(workspaceId));
  }

  /** Lists projects below one validated workspace-owned goal. */
  async listProjects(workspaceId: string, goalId: string): Promise<Project[]> {
    return await this.repository.listProjects(
      requireOpaqueId(workspaceId),
      requireOpaqueId(goalId),
    );
  }

  /** Lists tasks below one validated workspace-owned project. */
  async listTasks(workspaceId: string, projectId: string): Promise<Task[]> {
    return await this.repository.listTasks(
      requireOpaqueId(workspaceId),
      requireOpaqueId(projectId),
    );
  }

  /** Searches goals, projects, and tasks without returning workspace ownership. */
  async search(
    workspaceId: string,
    query: unknown,
    limit?: unknown,
  ): Promise<PlanningSearchResult[]> {
    const safeWorkspaceId = requireOpaqueId(workspaceId);
    const input = requirePlanningSearchInput(query, limit);
    const candidates = await this.repository.searchCandidates(
      safeWorkspaceId,
      input,
    );
    if (
      candidates.some((candidate) => candidate.workspaceId !== safeWorkspaceId)
    ) {
      throw new Error('Planning search crossed workspace boundary');
    }
    return rankPlanningSearchCandidates(candidates, input);
  }
}
