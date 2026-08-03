import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { HabitService } from './habit-domain';
import { HABIT_SERVICE, HabitController } from './habit-http-controller';
import { createHabitRuntime, HabitRuntime } from './habit-runtime';

export const HABIT_RUNTIME = Symbol('HABIT_RUNTIME');

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

void bootstrap();
