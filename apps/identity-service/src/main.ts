import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createIdentityRuntime, IdentityRuntime } from './identity-runtime';
import {
  OAUTH_CALLBACK_APPLICATION,
  OAUTH_HTTP_APPLICATION,
  OAuthHttpController,
} from './oauth-http-controller';

const IDENTITY_RUNTIME = Symbol('IDENTITY_RUNTIME');

@Controller()
class HealthController {
  @Get('health')
  health(): { status: 'ok'; service: 'identity-service' } {
    return { status: 'ok', service: 'identity-service' };
  }
}

@Module({
  controllers: [HealthController, OAuthHttpController],
  providers: [
    {
      provide: IDENTITY_RUNTIME,
      useFactory: (): IdentityRuntime => createIdentityRuntime(process.env),
    },
    {
      provide: OAUTH_HTTP_APPLICATION,
      inject: [IDENTITY_RUNTIME],
      useFactory: (runtime: IdentityRuntime) => runtime.application,
    },
    {
      provide: OAUTH_CALLBACK_APPLICATION,
      inject: [IDENTITY_RUNTIME],
      useFactory: (runtime: IdentityRuntime) => runtime.callbackApplication,
    },
  ],
})
class AppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.IDENTITY_SERVICE_PORT ?? 4101),
    '0.0.0.0',
  );
}

void bootstrap();
