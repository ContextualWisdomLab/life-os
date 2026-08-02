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

export class PlanningService {
  constructor(private readonly repository: PlanningRepository) {}

  createGoal(workspaceId: string, input: { title: string }): Goal {
    const goal: Goal = {
      id: randomUUID(),
      workspaceId,
      title: normalizeTitle(input.title),
      createdAt: new Date().toISOString(),
    };
    this.repository.saveGoal(goal);
    return goal;
  }

  createProject(workspaceId: string, input: { goalId: string; title: string }): Project {
    if (!this.repository.findGoal(workspaceId, input.goalId)) {
      throw new Error('Goal not found');
    }
    const project: Project = {
      id: randomUUID(),
      workspaceId,
      goalId: input.goalId,
      title: normalizeTitle(input.title),
      createdAt: new Date().toISOString(),
    };
    this.repository.saveProject(project);
    return project;
  }

  createTask(workspaceId: string, input: { projectId: string; title: string }): Task {
    if (!this.repository.findProject(workspaceId, input.projectId)) {
      throw new Error('Project not found');
    }
    const task: Task = {
      id: randomUUID(),
      workspaceId,
      projectId: input.projectId,
      title: normalizeTitle(input.title),
      status: 'todo',
      createdAt: new Date().toISOString(),
    };
    this.repository.saveTask(task);
    return task;
  }

  listGoals(workspaceId: string): Goal[] {
    return this.repository.listGoals(workspaceId);
  }

  listProjects(workspaceId: string, goalId: string): Project[] {
    return this.repository.listProjects(workspaceId, goalId);
  }

  listTasks(workspaceId: string, projectId: string): Task[] {
    return this.repository.listTasks(workspaceId, projectId);
  }
}
