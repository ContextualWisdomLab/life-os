import { randomUUID } from 'node:crypto';
import {
  matchesPlanningSearchTokens,
  rankPlanningSearchCandidates,
  requirePlanningSearchInput,
  type PlanningSearchCandidate,
  type PlanningSearchInput,
  type PlanningSearchResult,
} from './search';

export interface Goal {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  goalId: string;
  title: string;
  createdAt: string;
}

export interface Task {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  status: 'todo' | 'done';
  createdAt: string;
}

export interface PlanningRepository {
  saveGoal(goal: Goal): Promise<void>;
  saveProject(project: Project): Promise<void>;
  saveTask(task: Task): Promise<void>;
  findGoal(workspaceId: string, id: string): Promise<Goal | undefined>;
  findProject(workspaceId: string, id: string): Promise<Project | undefined>;
  listGoals(workspaceId: string): Promise<Goal[]>;
  listProjects(workspaceId: string, goalId: string): Promise<Project[]>;
  listTasks(workspaceId: string, projectId: string): Promise<Task[]>;
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

  async saveGoal(goal: Goal): Promise<void> {
    this.goals.set(goal.id, goal);
  }

  async saveProject(project: Project): Promise<void> {
    this.projects.set(project.id, project);
  }

  async saveTask(task: Task): Promise<void> {
    this.tasks.set(task.id, task);
  }

  async findGoal(workspaceId: string, id: string): Promise<Goal | undefined> {
    const goal = this.goals.get(id);
    return goal?.workspaceId === workspaceId ? goal : undefined;
  }

  async findProject(
    workspaceId: string,
    id: string,
  ): Promise<Project | undefined> {
    const project = this.projects.get(id);
    return project?.workspaceId === workspaceId ? project : undefined;
  }

  async listGoals(workspaceId: string): Promise<Goal[]> {
    return [...this.goals.values()].filter(
      (goal) => goal.workspaceId === workspaceId,
    );
  }

  async listProjects(workspaceId: string, goalId: string): Promise<Project[]> {
    return [...this.projects.values()].filter(
      (project) =>
        project.workspaceId === workspaceId && project.goalId === goalId,
    );
  }

  async listTasks(workspaceId: string, projectId: string): Promise<Task[]> {
    return [...this.tasks.values()].filter(
      (task) =>
        task.workspaceId === workspaceId && task.projectId === projectId,
    );
  }

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

function normalizeTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) {
    throw new Error('Title is required');
  }
  return normalized;
}

function requireOpaqueId(value: string): string {
  const normalized = value.trim();
  if (!normalized || /^\d+$/.test(normalized)) {
    throw new Error('Identifier must be an opaque non-numeric string');
  }
  return normalized;
}

function createOpaqueId(): string {
  return randomUUID();
}

/** Coordinates tenant-owned planning mutations, reads, and unified search. */
export class PlanningService {
  constructor(private readonly repository: PlanningRepository) {}

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

  async listGoals(workspaceId: string): Promise<Goal[]> {
    return await this.repository.listGoals(requireOpaqueId(workspaceId));
  }

  async listProjects(workspaceId: string, goalId: string): Promise<Project[]> {
    return await this.repository.listProjects(
      requireOpaqueId(workspaceId),
      requireOpaqueId(goalId),
    );
  }

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
