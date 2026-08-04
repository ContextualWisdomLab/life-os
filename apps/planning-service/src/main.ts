import 'reflect-metadata';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PROMETHEUS_CONTENT_TYPE } from '@life-os/observability';
import { requireTitle, toHttpException } from './http-boundary';
import {
  planningMetrics,
  planningObservabilityMiddleware,
} from './observability';
import type { Goal, Project, Task } from './planning-domain';
import { PlanningService } from './planning-domain';
import { createPlanningRuntime, PlanningRuntime } from './planning-runtime';

/** Dependency-injection token for the production planning runtime. */
export const PLANNING_RUNTIME = Symbol('PLANNING_RUNTIME');
/** Dependency-injection token for the planning domain service. */
export const PLANNING_SERVICE = Symbol('PLANNING_SERVICE');

/** Requires the tenant workspace boundary used by every planning operation. */
function requireWorkspaceId(value: string | undefined): string {
  const workspaceId = value?.trim();
  if (!workspaceId) {
    throw new BadRequestException('x-workspace-id header is required');
  }
  return workspaceId;
}

/** Exposes tenant-scoped planning operations and operational endpoints. */
@Controller()
export class PlanningController {
  constructor(
    @Inject(PLANNING_SERVICE)
    private readonly planningService: PlanningService,
  ) {}

  /** Returns a credential-free liveness response for the planning service. */
  @Get('health')
  health(): { status: 'ok'; service: 'planning-service' } {
    return { status: 'ok', service: 'planning-service' };
  }

  /** Renders bounded planning-service metrics for trusted Prometheus scrapes. */
  @Get('metrics')
  @Header('Content-Type', PROMETHEUS_CONTENT_TYPE)
  metrics(): string {
    return planningMetrics.renderPrometheus();
  }

  /** Creates a goal inside the caller's required workspace. */
  @Post('goals')
  async createGoal(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Body() body: { title?: unknown },
  ): Promise<Goal> {
    try {
      return await this.planningService.createGoal(
        requireWorkspaceId(workspaceHeader),
        {
          title: requireTitle(body),
        },
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Lists goals belonging to the caller's required workspace. */
  @Get('goals')
  async listGoals(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
  ): Promise<Goal[]> {
    try {
      return await this.planningService.listGoals(
        requireWorkspaceId(workspaceHeader),
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Creates a project below a workspace-owned goal. */
  @Post('goals/:goalId/projects')
  async createProject(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Param('goalId') goalId: string,
    @Body() body: { title?: unknown },
  ): Promise<Project> {
    try {
      return await this.planningService.createProject(
        requireWorkspaceId(workspaceHeader),
        {
          goalId,
          title: requireTitle(body),
        },
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Lists projects below a workspace-owned goal. */
  @Get('goals/:goalId/projects')
  async listProjects(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Param('goalId') goalId: string,
  ): Promise<Project[]> {
    try {
      return await this.planningService.listProjects(
        requireWorkspaceId(workspaceHeader),
        goalId,
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Creates a task below a workspace-owned project. */
  @Post('projects/:projectId/tasks')
  async createTask(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Param('projectId') projectId: string,
    @Body() body: { title?: unknown },
  ): Promise<Task> {
    try {
      return await this.planningService.createTask(
        requireWorkspaceId(workspaceHeader),
        {
          projectId,
          title: requireTitle(body),
        },
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Lists tasks below a workspace-owned project. */
  @Get('projects/:projectId/tasks')
  async listTasks(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Param('projectId') projectId: string,
  ): Promise<Task[]> {
    try {
      return await this.planningService.listTasks(
        requireWorkspaceId(workspaceHeader),
        projectId,
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }
}

/** Root NestJS module for the production planning-service process. */
@Module({
  controllers: [PlanningController],
  providers: [
    {
      provide: PLANNING_RUNTIME,
      useFactory: (): PlanningRuntime => createPlanningRuntime(process.env),
    },
    {
      provide: PLANNING_SERVICE,
      inject: [PLANNING_RUNTIME],
      useFactory: (runtime: PlanningRuntime): PlanningService =>
        runtime.service,
    },
  ],
})
export class AppModule {}

/** Boots the instrumented planning service on its configured public port. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.use(planningObservabilityMiddleware);
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.PLANNING_SERVICE_PORT ?? 4102),
    '0.0.0.0',
  );
}

void bootstrap();
