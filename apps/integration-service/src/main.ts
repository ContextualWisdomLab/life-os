import 'reflect-metadata';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  Module,
  Post,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PluginContractError } from '@life-os/plugin-sdk';
import {
  InMemoryPluginRegistry,
  type PluginInstallation,
  type PluginRegistry,
  PluginRegistryError,
  requireWorkspaceId,
} from './plugin-registry';

/** Dependency-injection token for the plugin registry implementation. */
export const PLUGIN_REGISTRY = Symbol('PLUGIN_REGISTRY');

function toHttpException(error: unknown): Error {
  if (error instanceof PluginContractError) {
    return new BadRequestException({ error: error.code });
  }
  if (error instanceof PluginRegistryError) {
    if (error.code === 'plugin_already_registered') {
      return new ConflictException({ error: error.code });
    }
    return new BadRequestException({ error: error.code });
  }
  return new BadRequestException({ error: 'plugin_request_invalid' });
}

/** Versioned public API for tenant-scoped third-party plugin contracts. */
@Controller()
export class IntegrationController {
  constructor(
    @Inject(PLUGIN_REGISTRY)
    private readonly pluginRegistry: PluginRegistry,
  ) {}

  /** Returns a credential-free liveness response. */
  @Get('health')
  health(): { status: 'ok'; service: 'integration-service' } {
    return { status: 'ok', service: 'integration-service' };
  }

  /** Registers a validated plugin without granting direct database access. */
  @Post('plugins')
  registerPlugin(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Body() body: unknown,
  ): PluginInstallation {
    try {
      return this.pluginRegistry.register(
        requireWorkspaceId(workspaceHeader),
        body,
      );
    } catch (error) {
      throw toHttpException(error);
    }
  }

  /** Lists plugin contracts visible to the requesting workspace only. */
  @Get('plugins')
  listPlugins(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
  ): readonly PluginInstallation[] {
    try {
      return this.pluginRegistry.list(requireWorkspaceId(workspaceHeader));
    } catch (error) {
      throw toHttpException(error);
    }
  }
}

/** Root module for the integration-service process. */
@Module({
  controllers: [IntegrationController],
  providers: [
    {
      provide: PLUGIN_REGISTRY,
      useFactory: (): PluginRegistry => new InMemoryPluginRegistry(),
    },
  ],
})
export class AppModule {}

/** Boots the versioned integration surface on its configured public port. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.INTEGRATION_SERVICE_PORT ?? 4105),
    '0.0.0.0',
  );
}

if (require.main === module) {
  void bootstrap();
}
