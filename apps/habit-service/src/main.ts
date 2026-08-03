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
import type {
  Habit,
  HabitCompletionEvent,
  HabitOccurrence,
} from './habit-domain';
import { HabitService } from './habit-domain';
import { createHabitRuntime, HabitRuntime } from './habit-runtime';
import {
  parseCompleteHabitRequest,
  parseCreateHabitRequest,
  requireHabitId,
  requireLocalDateQuery,
  requireWorkspaceId,
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
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Body() body: unknown,
  ): Promise<Habit> {
    try {
      return await this.habitService.createHabit(
        requireWorkspaceId(workspaceHeader),
        parseCreateHabitRequest(body),
      );
    } catch (error) {
      throw toHabitHttpException(error);
    }
  }

  @Get('habits')
  async listHabits(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
  ): Promise<Habit[]> {
    try {
      return await this.habitService.listHabits(
        requireWorkspaceId(workspaceHeader),
      );
    } catch (error) {
      throw toHabitHttpException(error);
    }
  }

  @Get('habits/:habitId/occurrences')
  async listOccurrences(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Param('habitId') habitId: string,
    @Query('from') fromLocalDate: string | undefined,
    @Query('to') toLocalDate: string | undefined,
  ): Promise<HabitOccurrence[]> {
    try {
      return await this.habitService.listOccurrences(
        requireWorkspaceId(workspaceHeader),
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
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Param('habitId') habitId: string,
    @Body() body: unknown,
  ): Promise<HabitCompletionEvent> {
    try {
      return await this.habitService.completeHabit(
        requireWorkspaceId(workspaceHeader),
        requireHabitId(habitId),
        parseCompleteHabitRequest(body),
      );
    } catch (error) {
      throw toHabitHttpException(error);
    }
  }

  @Get('habits/:habitId/completions')
  async listCompletionHistory(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Param('habitId') habitId: string,
  ): Promise<HabitCompletionEvent[]> {
    try {
      return await this.habitService.listCompletionHistory(
        requireWorkspaceId(workspaceHeader),
        requireHabitId(habitId),
      );
    } catch (error) {
      throw toHabitHttpException(error);
    }
  }
}

@Module({
  controllers: [HabitController],
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
