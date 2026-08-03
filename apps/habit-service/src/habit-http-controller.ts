import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type {
  Habit,
  HabitCompletionEvent,
  HabitOccurrence,
} from './habit-domain';
import { HabitService } from './habit-domain';
import {
  parseCompleteHabitRequest,
  parseCreateHabitRequest,
  parseOccurrenceRange,
  requireHabitId,
  requireWorkspaceId,
  toHabitHttpException,
} from './habit-http-boundary';

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
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ): Promise<HabitOccurrence[]> {
    try {
      const range = parseOccurrenceRange(from, to);
      return await this.habitService.listOccurrences(
        requireWorkspaceId(workspaceHeader),
        requireHabitId(habitId),
        range.from,
        range.to,
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
