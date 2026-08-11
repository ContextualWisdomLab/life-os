import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Module,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { HabitDataRightsResponse } from './habit-data-rights';
import {
  parseTrustedHabitDataRightsRequest,
  toHabitDataRightsHttpException,
} from './habit-data-rights-http-boundary';
import type {
  Habit,
  HabitCompletionEvent,
  HabitOccurrence,
  HabitTodayStatus,
} from './habit-domain';
import { HabitService } from './habit-domain';
import { createHabitRuntime, HabitRuntime } from './habit-runtime';
import {
  parseCompleteHabitRequest,
  parseCreateHabitRequest,
  requireHabitId,
  requireLocalDateQuery,
  requireTrustedWorkspaceContext,
  toHabitHttpException,
} from './http-boundary';

export const HABIT_RUNTIME = Symbol('HABIT_RUNTIME');
export const HABIT_SERVICE = Symbol('HABIT_SERVICE');

@Controller()
export class HabitController {
  constructor(
    @Inject(HABIT_SERVICE)
    private readonly habitService: HabitService,
  ) {}

  @Get('health')
  health(): { status: 'ok'; service: 'habit-service' } {
    return { status: 'ok', service: 'habit-service' };
  }

  @Post('habits')
  async createHabit(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Body() body: unknown,
  ): Promise<Habit> {
    try {
      return await this.habitService.createHabit(
        requireTrustedWorkspaceContext(
          { workspaceId, issuedAt, signature },
          process.env.HABIT_GATEWAY_CONTEXT_SECRET,
        ),
        parseCreateHabitRequest(body),
      );
    } catch (error) {
      throw toHabitHttpException(error);
    }
  }

  @Get('habits')
  async listHabits(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
  ): Promise<Habit[]> {
    try {
      return await this.habitService.listHabits(
        requireTrustedWorkspaceContext(
          { workspaceId, issuedAt, signature },
          process.env.HABIT_GATEWAY_CONTEXT_SECRET,
        ),
      );
    } catch (error) {
      throw toHabitHttpException(error);
    }
  }

  /** Returns only Habit-owned scheduled/completion evidence for one local date. */
  @Get('habits/today')
  async listTodayHabits(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Query('date') localDate: string | undefined,
  ): Promise<HabitTodayStatus[]> {
    try {
      return await this.habitService.listTodayHabits(
        requireTrustedWorkspaceContext(
          { workspaceId, issuedAt, signature },
          process.env.HABIT_GATEWAY_CONTEXT_SECRET,
        ),
        localDate ?? '',
      );
    } catch (error) {
      throw toHabitHttpException(error);
    }
  }

  @Get('habits/:habitId/occurrences')
  async listOccurrences(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Param('habitId') habitId: string,
    @Query('from') fromLocalDate: string | undefined,
    @Query('to') toLocalDate: string | undefined,
  ): Promise<HabitOccurrence[]> {
    try {
      return await this.habitService.listOccurrences(
        requireTrustedWorkspaceContext(
          { workspaceId, issuedAt, signature },
          process.env.HABIT_GATEWAY_CONTEXT_SECRET,
        ),
        requireHabitId(habitId),
        requireLocalDateQuery(fromLocalDate, 'from'),
        requireLocalDateQuery(toLocalDate, 'to'),
      );
    } catch (error) {
      throw toHabitHttpException(error);
    }
  }

  @Post('habits/:habitId/completions')
  async completeHabit(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Param('habitId') habitId: string,
    @Body() body: unknown,
  ): Promise<HabitCompletionEvent> {
    try {
      return await this.habitService.completeHabit(
        requireTrustedWorkspaceContext(
          { workspaceId, issuedAt, signature },
          process.env.HABIT_GATEWAY_CONTEXT_SECRET,
        ),
        requireHabitId(habitId),
        parseCompleteHabitRequest(body),
      );
    } catch (error) {
      throw toHabitHttpException(error);
    }
  }

  @Get('habits/:habitId/completions')
  async listCompletionHistory(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Param('habitId') habitId: string,
  ): Promise<HabitCompletionEvent[]> {
    try {
      return await this.habitService.listCompletionHistory(
        requireTrustedWorkspaceContext(
          { workspaceId, issuedAt, signature },
          process.env.HABIT_GATEWAY_CONTEXT_SECRET,
        ),
        requireHabitId(habitId),
      );
    } catch (error) {
      throw toHabitHttpException(error);
    }
  }
}

/** Internal service-authenticated transport for Habit-owned data-rights work. */
@Controller('internal/data-rights')
export class HabitDataRightsController {
  constructor(
    @Inject(HABIT_RUNTIME)
    private readonly runtime: HabitRuntime,
  ) {}

  /** Executes only the exact v1 contributor request authorized by Identity. */
  @Post('contributor')
  async contribute(
    @Headers('x-life-os-data-rights-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-data-rights-signature') signature: string | undefined,
    @Body() body: unknown,
  ): Promise<HabitDataRightsResponse> {
    try {
      const request = parseTrustedHabitDataRightsRequest(
        body,
        { issuedAt, signature },
        process.env.HABIT_DATA_RIGHTS_CONTEXT_SECRET,
        {
          method: 'POST',
          path: '/v1/internal/data-rights/contributor',
        },
      );
      return await this.runtime.dataRightsContributor.handle(request);
    } catch (error) {
      throw toHabitDataRightsHttpException(error);
    }
  }
}

@Module({
  controllers: [HabitController, HabitDataRightsController],
  providers: [
    {
      provide: HABIT_RUNTIME,
      useFactory: (): HabitRuntime => createHabitRuntime(process.env),
    },
    {
      provide: HABIT_SERVICE,
      inject: [HABIT_RUNTIME],
      useFactory: (runtime: HabitRuntime): HabitService => runtime.service,
    },
  ],
})
export class AppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  await app.listen(Number(process.env.HABIT_SERVICE_PORT ?? 4103), '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}
