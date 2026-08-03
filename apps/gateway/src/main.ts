import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { gatewayObservabilityMiddleware } from './observability';

/** Parses the bounded comma-separated browser origins allowed by CORS. */
function getAllowedOrigins(): string[] {
  return (process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** Boots the instrumented gateway and listens on the configured public port. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.use(gatewayObservabilityMiddleware);
  app.enableCors({
    origin: getAllowedOrigins(),
    credentials: true,
    exposedHeaders: ['x-correlation-id'],
  });
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  const port = Number(process.env.GATEWAY_PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
