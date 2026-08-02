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
  createGoal(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Body() body: { title: string },
  ): Goal {
    return planningService.createGoal(requireWorkspaceId(workspaceHeader), body);
  }

  @Get('goals')
  listGoals(@Headers('x-workspace-id') workspaceHeader: string | undefined): Goal[] {
    return planningService.listGoals(requireWorkspaceId(workspaceHeader));
  }

  @Post('goals/:goalId/projects')
  createProject(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Param('goalId') goalId: string,
    @Body() body: { title: string },
  ): Project {
    return planningService.createProject(requireWorkspaceId(workspaceHeader), {
      goalId,
      title: body.title,
    });
  }

  @Get('goals/:goalId/projects')
  listProjects(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Param('goalId') goalId: string,
  ): Project[] {
    return planningService.listProjects(requireWorkspaceId(workspaceHeader), goalId);
  }

  @Post('projects/:projectId/tasks')
  createTask(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Param('projectId') projectId: string,
    @Body() body: { title: string },
  ): Task {
    return planningService.createTask(requireWorkspaceId(workspaceHeader), {
      projectId,
      title: body.title,
    });
  }

  @Get('projects/:projectId/tasks')
  listTasks(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Param('projectId') projectId: string,
  ): Task[] {
    return planningService.listTasks(requireWorkspaceId(workspaceHeader), projectId);
  }
}

@Module({ controllers: [PlanningController] })
class AppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PLANNING_SERVICE_PORT ?? 4102), '0.0.0.0');
}

void bootstrap();
