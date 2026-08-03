import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Module,
  Post,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  getPluginContractDiscovery,
  type PluginContractDiscovery,
  PluginContractError,
  type PluginManifest,
  type PreparedPluginEvent,
  preparePluginEvent,
  validatePluginManifest,
} from '@life-os/plugin-sdk';

interface IntegrationProblemDetails {
  readonly type: 'about:blank';
  readonly title: string;
  readonly status: number;
  readonly code: 'invalid_plugin_contract';
}

function invalidContract(): HttpException {
  const problem: IntegrationProblemDetails = {
    type: 'about:blank',
    title: 'Plugin contract is invalid',
    status: 400,
    code: 'invalid_plugin_contract',
  };
  return new HttpException(problem, 400);
}

@Controller()
export class IntegrationController {
  @Get('health')
  health(): { readonly status: 'ok'; readonly service: 'integration-service' } {
    return { status: 'ok', service: 'integration-service' };
  }

  @Get('v1/plugin-contract')
  contract(): PluginContractDiscovery {
    return getPluginContractDiscovery();
  }

  @Post('v1/plugins/validate-manifest')
  @HttpCode(200)
  validateManifest(@Body() body: unknown): PluginManifest {
    try {
      return validatePluginManifest(body);
    } catch (error) {
      if (error instanceof PluginContractError) {
        throw invalidContract();
      }
      throw error;
    }
  }

  @Post('v1/events/prepare')
  @HttpCode(200)
  prepareEvent(
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() body: unknown,
  ): PreparedPluginEvent {
    try {
      if (!workspaceId) {
        throw new PluginContractError();
      }
      return preparePluginEvent(workspaceId, body);
    } catch (error) {
      if (error instanceof PluginContractError) {
        throw invalidContract();
      }
      throw error;
    }
  }
}

@Module({ controllers: [IntegrationController] })
export class IntegrationAppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(IntegrationAppModule);
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.INTEGRATION_SERVICE_PORT ?? 4107),
    '0.0.0.0',
  );
}

if (require.main === module) {
  void bootstrap();
}
