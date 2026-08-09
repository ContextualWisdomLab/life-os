import 'reflect-metadata';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpException,
  Inject,
  Module,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PROMETHEUS_CONTENT_TYPE } from '@life-os/observability';
import {
  requireTitle,
  requireTrustedWorkspaceContext,
  toHttpException,
} from './http-boundary';
import {
  planningMetrics,
  planningObservabilityMiddleware,
} from './observability';
import type { Goal, Project, Task } from './planning-domain';
import { PlanningService } from './planning-domain';
import { createPlanningRuntime, PlanningRuntime } from './planning-runtime';
import type { PlanningSearchResult } from './search';
import {
  parseTodayWritePrecondition,
  requireTodayPathDate,
  toTodayHttpException,
} from './today-http';
import {
  TodaySyncService,
  TodayValidationError,
  type DurableTodayAggregate,
} from './today-sync';

/** Dependency-injection token for the production planning runtime. */
export const PLANNING_RUNTIME = Symbol('PLANNING_RUNTIME');
/** Dependency-injection token for the planning domain service. */
export const PLANNING_SERVICE = Symbol('PLANNING_SERVICE');
/** Dependency-injection token for durable Today synchronization. */
export const TODAY_SYNC_SERVICE = Symbol('TODAY_SYNC_SERVICE');

interface PassthroughResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
}

/** Requires the tenant workspace boundary used by legacy planning operations. */
function requireWorkspaceId(value: string | undefined): string {
  const workspaceId = value?.trim();
  if (!workspaceId) {
    throw new BadRequestException('x-workspace-id header is required');
  }
  return workspaceId;
}

/** Returns a stable not-found problem without disclosing another tenant's state. */
function todayNotFound(): HttpException {
  return new HttpException(
    {
      type: 'about:blank',
      title: 'Today aggregate was not found',
      status: 404,
      code: 'today_not_found',
    },
    404,
  );
}

/** Applies no-store and the strong opaque revision ETag to a Today response. */
function setTodayResponseHeaders(
  response: PassthroughResponse,
  aggregate: DurableTodayAggregate,
): void {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('etag', `"${aggregate.revision}"`);
}

/** Exposes tenant-scoped planning operations and operational endpoints. */
@Controller()
export class PlanningController {
  constructor(
    @Inject(PLANNING_SERVICE)
    private readonly planningService: PlanningService,
    @Inject(TODAY_SYNC_SERVICE)
    private readonly todayService: TodaySyncService,
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

  /** Searches planning records inside a short-lived authenticated gateway scope. */
  @Get('search')
  async search(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Query('q') query: string | undefined,
    @Query('limit') limit: string | undefined,
  ): Promise<PlanningSearchResult[]> {
    try {
      const trustedWorkspaceId = requireTrustedWorkspaceContext(
        { workspaceId, issuedAt, signature },
        process.env.PLANNING_GATEWAY_CONTEXT_SECRET,
      );
      return await this.planningService.search(
        trustedWorkspaceId,
        query,
        limit,
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Returns one durable Today aggregate for the authenticated workspace/date. */
  @Get('today/:date')
  async getToday(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Param('date') date: string,
    @Res({ passthrough: true }) response: PassthroughResponse,
  ): Promise<DurableTodayAggregate> {
    try {
      const trustedWorkspaceId = requireTrustedWorkspaceContext(
        { workspaceId, issuedAt, signature },
        process.env.PLANNING_GATEWAY_CONTEXT_SECRET,
      );
      const aggregate = await this.todayService.getToday(
        trustedWorkspaceId,
        date,
      );
      if (!aggregate) {
        throw todayNotFound();
      }
      setTodayResponseHeaders(response, aggregate);
      return aggregate;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw toTodayHttpException(error);
    }
  }

  /** Creates or replaces one complete Today aggregate behind HTTP preconditions. */
  @Put('today/:date')
  async putToday(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Headers('if-match') ifMatch: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('date') date: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: PassthroughResponse,
  ): Promise<DurableTodayAggregate> {
    try {
      const trustedWorkspaceId = requireTrustedWorkspaceContext(
        { workspaceId, issuedAt, signature },
        process.env.PLANNING_GATEWAY_CONTEXT_SECRET,
      );
      requireTodayPathDate(date, body);
      if (typeof idempotencyKey !== 'string') {
        throw new TodayValidationError();
      }
      const result = await this.todayService.putToday(
        trustedWorkspaceId,
        body,
        parseTodayWritePrecondition(ifMatch, ifNoneMatch),
        idempotencyKey,
      );
      response.statusCode = result.kind === 'created' ? 201 : 200;
      setTodayResponseHeaders(response, result.aggregate);
      return result.aggregate;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw toTodayHttpException(error);
    }
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
    {
      provide: TODAY_SYNC_SERVICE,
      inject: [PLANNING_RUNTIME],
      useFactory: (runtime: PlanningRuntime): TodaySyncService =>
        runtime.todayService,
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
