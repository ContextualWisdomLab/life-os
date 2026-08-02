import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

@Controller()
class HealthController {
  @Get('health')
  health(): { status: 'ok'; service: 'planning-service' } {
    return { status: 'ok', service: 'planning-service' };
  }
}

@Module({ controllers: [HealthController] })
class AppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PLANNING_SERVICE_PORT ?? 4102), '0.0.0.0');
}

void bootstrap();
