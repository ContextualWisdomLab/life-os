export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface RequestContext {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  correlationId: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  correlationId: string;
  errors?: Record<string, string[]>;
}

export interface DomainEvent<TPayload = unknown> {
  id: string;
  type: string;
  version: 1;
  occurredAt: string;
  actorId: string;
  workspaceId: string;
  correlationId: string;
  causationId?: string;
  payload: TPayload;
}

export interface TaskCompletedPayload {
  taskId: string;
  projectId?: string;
  goalId?: string;
  completedAt: string;
}

export type TaskCompletedEvent = DomainEvent<TaskCompletedPayload> & {
  type: 'planning.task.completed.v1';
};
