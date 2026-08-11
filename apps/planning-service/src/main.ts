import 'reflect-metadata';
import {
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
import type {
  DataRightsContributorResponse,
  Goal,
  Project,
  Task,
} from './planning-data-rights';
import {
  parseTrustedPlanningDataRightsRequest,
  toPlanningDataRightsHttpException,
} from './planning-data-rights-http-boundary';
import type { Goal as PlanningGoal, Project as PlanningProject, Task as PlanningTask } from './planning-domain';
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
        { method: 'GET', path: '/v1/search' },
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
        { method: 'GET', path: `/v1/today/${date}` },
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
        { method: 'PUT', path: `/v1/today/${date}` },
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

  /** Creates a goal inside the signed gateway workspace. */
  @Post('goals')
  async createGoal(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Body() body: { title?: unknown },
  ): Promise<PlanningGoal> {
    try {
      const trustedWorkspaceId = requireTrustedWorkspaceContext(
        { workspaceId, issuedAt, signature },
        process.env.PLANNING_GATEWAY_CONTEXT_SECRET,
        { method: 'POST', path: '/v1/goals' },
      );
      return await this.planningService.createGoal(trustedWorkspaceId, {
        title: requireTitle(body),
      });
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Lists goals belonging to the signed gateway workspace. */
  @Get('goals')
  async listGoals(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
  ): Promise<PlanningGoal[]> {
    try {
      const trustedWorkspaceId = requireTrustedWorkspaceContext(
        { workspaceId, issuedAt, signature },
        process.env.PLANNING_GATEWAY_CONTEXT_SECRET,
        { method: 'GET', path: '/v1/goals' },
      );
      return await this.planningService.listGoals(trustedWorkspaceId);
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Creates a project below a goal in the signed gateway workspace. */
  @Post('goals/:goalId/projects')
  async createProject(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Param('goalId') goalId: string,
    @Body() body: { title?: unknown },
  ): Promise<PlanningProject> {
    try {
      const trustedWorkspaceId = requireTrustedWorkspaceContext(
        { workspaceId, issuedAt, signature },
        process.env.PLANNING_GATEWAY_CONTEXT_SECRET,
        { method: 'POST', path: `/v1/goals/${goalId}/projects` },
      );
      return await this.planningService.createProject(trustedWorkspaceId, {
        goalId,
        title: requireTitle(body),
      });
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Lists projects below a goal in the signed gateway workspace. */
  @Get('goals/:goalId/projects')
  async listProjects(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Param('goalId') goalId: string,
  ): Promise<PlanningProject[]> {
    try {
      const trustedWorkspaceId = requireTrustedWorkspaceContext(
        { workspaceId, issuedAt, signature },
        process.env.PLANNING_GATEWAY_CONTEXT_SECRET,
        { method: 'GET', path: `/v1/goals/${goalId}/projects` },
      );
      return await this.planningService.listProjects(
        trustedWorkspaceId,
        goalId,
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Creates a task below a project in the signed gateway workspace. */
  @Post('projects/:projectId/tasks')
  async createTask(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Param('projectId') projectId: string,
    @Body() body: { title?: unknown },
  ): Promise<PlanningTask> {
    try {
      const trustedWorkspaceId = requireTrustedWorkspaceContext(
        { workspaceId, issuedAt, signature },
        process.env.PLANNING_GATEWAY_CONTEXT_SECRET,
        { method: 'POST', path: `/v1/projects/${projectId}/tasks` },
      );
      return await this.planningService.createTask(trustedWorkspaceId, {
        projectId,
        title: requireTitle(body),
      });
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Lists tasks below a project in the signed gateway workspace. */
  @Get('projects/:projectId/tasks')
  async listTasks(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Param('projectId') projectId: string,
  ): Promise<PlanningTask[]> {
    try {
      const trustedWorkspaceId = requireTrustedWorkspaceContext(
        { workspaceId, issuedAt, signature },
        process.env.PLANNING_GATEWAY_CONTEXT_SECRET,
        { method: 'GET', path: `/v1/projects/${projectId}/tasks` },
      );
      return await this.planningService.listTasks(
        trustedWorkspaceId,
        projectId,
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }
}

/** Internal service-authenticated transport for Planning-owned data-rights work. */
@Controller('internal/data-rights')
export class PlanningDataRightsController {
  constructor(
    @Inject(PLANNING_RUNTIME)
    private readonly runtime: PlanningRuntime,
  ) {}

  /** Executes only the exact v1 contributor request authorized by Identity. */
  @Post('contributor')
  async contribute(
    @Headers('x-life-os-data-rights-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-data-rights-signature') signature: string | undefined,
    @Body() body: unknown,
  ): Promise<DataRightsContributorResponse> {
    const request = await parseTrustedPlanningDataRightsRequest(
      body,
      { issuedAt, signature },
      process.env.PLANNING_DATA_RIGHTS_CONTEXT_SECRET,
      {
        method: 'POST',
        path: '/v1/internal/data-rights/contributor',
      },
    );
    try {
      return await this.runtime.dataRightsContributor.handle(request);
    } catch (error) {
      throw toPlanningDataRightsHttpException(error);
    }
  }
}

/** Root NestJS module for the production planning-service process. */
@Module({
  controllers: [PlanningController, PlanningDataRightsController],
  providers: [
    {
      provide: PLANNING_RUNTIME,
      useFactory: (): PlanningRuntime => createPlanningRuntime(process.env),
    },
    {
      provide: PLANNING_SERVICE,
      inject: [PLANNING_RUNTIME],
      useFactory: (runtime: PlanningRuntime): PlanningService => runtime.service,
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
