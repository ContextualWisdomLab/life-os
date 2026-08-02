import { randomUUID } from 'node:crypto';

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
  saveGoal(goal: Goal): void;
  saveProject(project: Project): void;
  saveTask(task: Task): void;
  findGoal(workspaceId: string, id: string): Goal | undefined;
  findProject(workspaceId: string, id: string): Project | undefined;
  listGoals(workspaceId: string): Goal[];
  listProjects(workspaceId: string, goalId: string): Project[];
  listTasks(workspaceId: string, projectId: string): Task[];
}

export class InMemoryPlanningRepository implements PlanningRepository {
  private readonly goals = new Map<string, Goal>();
  private readonly projects = new Map<string, Project>();
  private readonly tasks = new Map<string, Task>();

  saveGoal(goal: Goal): void {
    this.goals.set(goal.id, goal);
  }

  saveProject(project: Project): void {
    this.projects.set(project.id, project);
  }

  saveTask(task: Task): void {
    this.tasks.set(task.id, task);
  }

  findGoal(workspaceId: string, id: string): Goal | undefined {
    const goal = this.goals.get(id);
    return goal?.workspaceId === workspaceId ? goal : undefined;
  }

  findProject(workspaceId: string, id: string): Project | undefined {
    const project = this.projects.get(id);
    return project?.workspaceId === workspaceId ? project : undefined;
  }

  listGoals(workspaceId: string): Goal[] {
    return [...this.goals.values()].filter((goal) => goal.workspaceId === workspaceId);
  }

  listProjects(workspaceId: string, goalId: string): Project[] {
    return [...this.projects.values()].filter(
      (project) => project.workspaceId === workspaceId && project.goalId === goalId,
    );
  }

  listTasks(workspaceId: string, projectId: string): Task[] {
    return [...this.tasks.values()].filter(
      (task) => task.workspaceId === workspaceId && task.projectId === projectId,
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

export class PlanningService {
  constructor(private readonly repository: PlanningRepository) {}

  createGoal(workspaceId: string, input: { title: string }): Goal {
    const safeWorkspaceId = requireOpaqueId(workspaceId);
    const goal: Goal = {
      id: createOpaqueId(),
      workspaceId: safeWorkspaceId,
      title: normalizeTitle(input.title),
      createdAt: new Date().toISOString(),
    };
    this.repository.saveGoal(goal);
    return goal;
  }

  createProject(workspaceId: string, input: { goalId: string; title: string }): Project {
    const safeWorkspaceId = requireOpaqueId(workspaceId);
    const safeGoalId = requireOpaqueId(input.goalId);
    if (!this.repository.findGoal(safeWorkspaceId, safeGoalId)) {
      throw new Error('Goal not found');
    }
    const project: Project = {
      id: createOpaqueId(),
      workspaceId: safeWorkspaceId,
      goalId: safeGoalId,
      title: normalizeTitle(input.title),
      createdAt: new Date().toISOString(),
    };
    this.repository.saveProject(project);
    return project;
  }

  createTask(workspaceId: string, input: { projectId: string; title: string }): Task {
    const safeWorkspaceId = requireOpaqueId(workspaceId);
    const safeProjectId = requireOpaqueId(input.projectId);
    if (!this.repository.findProject(safeWorkspaceId, safeProjectId)) {
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
    this.repository.saveTask(task);
    return task;
  }

  listGoals(workspaceId: string): Goal[] {
    return this.repository.listGoals(requireOpaqueId(workspaceId));
  }

  listProjects(workspaceId: string, goalId: string): Project[] {
    return this.repository.listProjects(requireOpaqueId(workspaceId), requireOpaqueId(goalId));
  }

  listTasks(workspaceId: string, projectId: string): Task[] {
    return this.repository.listTasks(requireOpaqueId(workspaceId), requireOpaqueId(projectId));
  }
}
