import 'reflect-metadata';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { requireTitle, toHttpException } from './http-boundary';
import {
  Goal,
  InMemoryPlanningRepository,
  PlanningService,
  Project,
  Task,
} from './planning-domain';

const planningService = new PlanningService(new InMemoryPlanningRepository());

function requireWorkspaceId(value: string | undefined): string {
  const workspaceId = value?.trim();
  if (!workspaceId) {
    throw new BadRequestException('x-workspace-id header is required');
  }
  return workspaceId;
}

@Controller()
class PlanningController {
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
      return await planningService.createGoal(
        requireWorkspaceId(workspaceHeader),
        { title: requireTitle(body) },
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @Get('goals')
  async listGoals(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
  ): Promise<Goal[]> {
    return await planningService.listGoals(requireWorkspaceId(workspaceHeader));
  }

  @Post('goals/:goalId/projects')
  async createProject(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Param('goalId') goalId: string,
    @Body() body: { title?: unknown },
  ): Promise<Project> {
    try {
      return await planningService.createProject(
        requireWorkspaceId(workspaceHeader),
        { goalId, title: requireTitle(body) },
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
    return await planningService.listProjects(
      requireWorkspaceId(workspaceHeader),
      goalId,
    );
  }

  @Post('projects/:projectId/tasks')
  async createTask(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Param('projectId') projectId: string,
    @Body() body: { title?: unknown },
  ): Promise<Task> {
    try {
      return await planningService.createTask(
        requireWorkspaceId(workspaceHeader),
        { projectId, title: requireTitle(body) },
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
    return await planningService.listTasks(
      requireWorkspaceId(workspaceHeader),
      projectId,
    );
  }
}

@Module({ controllers: [PlanningController] })
class AppModule {}

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
