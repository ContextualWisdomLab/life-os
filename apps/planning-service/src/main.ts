import 'reflect-metadata';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { requireTitle, toHttpException } from './http-boundary';
import type { Goal, Project, Task } from './planning-domain';
import { PlanningService } from './planning-domain';
import { createPlanningRuntime, PlanningRuntime } from './planning-runtime';

export const PLANNING_RUNTIME = Symbol('PLANNING_RUNTIME');
export const PLANNING_SERVICE = Symbol('PLANNING_SERVICE');

function requireWorkspaceId(value: string | undefined): string {
  const workspaceId = value?.trim();
  if (!workspaceId) {
    throw new BadRequestException('x-workspace-id header is required');
  }
  return workspaceId;
}

@Controller()
export class PlanningController {
  constructor(
    @Inject(PLANNING_SERVICE)
    private readonly planningService: PlanningService,
  ) {}

  @Get('health')
  health(): { status: 'ok'; service: 'planning-service' } {
    return { status: 'ok', service: 'planning-service' };
  }

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

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.PLANNING_SERVICE_PORT ?? 4102),
    '0.0.0.0',
  );
}

void bootstrap();
