import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  const port = Number(process.env.GATEWAY_PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
