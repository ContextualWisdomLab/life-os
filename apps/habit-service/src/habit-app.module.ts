import { Module } from '@nestjs/common';
import { HabitService } from './habit-domain';
import { HabitController } from './http-boundary';
import { createHabitRuntime, HabitRuntime } from './habit-runtime';

export const HABIT_RUNTIME = Symbol('HABIT_RUNTIME');
export const HABIT_SERVICE = Symbol('HABIT_SERVICE');

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
export class HabitAppModule {}
