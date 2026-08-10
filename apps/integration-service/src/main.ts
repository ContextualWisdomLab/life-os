import 'reflect-metadata';
import { createHmac, timingSafeEqual } from 'node:crypto';
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

type IntegrationProblemCode =
  | 'invalid_plugin_contract'
  | 'invalid_gateway_context'
  | 'gateway_context_unavailable';

interface IntegrationProblemDetails {
  readonly type: 'about:blank';
  readonly title: string;
  readonly status: number;
  readonly code: IntegrationProblemCode;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNIX_SECONDS_PATTERN = /^(?:0|[1-9]\d{0,12})$/u;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MINIMUM_GATEWAY_SECRET_BYTES = 32;
const MAXIMUM_CONTEXT_AGE_SECONDS = 60;
const MAXIMUM_FUTURE_SKEW_SECONDS = 5;

function problemException(
  status: number,
  title: string,
  code: IntegrationProblemCode,
): HttpException {
  const problem: IntegrationProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(problem, status);
}

function invalidContract(): HttpException {
  return problemException(400, 'Plugin contract is invalid', 'invalid_plugin_contract');
}

function invalidGatewayContext(): never {
  throw problemException(
    401,
    'Trusted gateway context is invalid',
    'invalid_gateway_context',
  );
}

function unavailableGatewayContext(): never {
  throw problemException(
    503,
    'Trusted gateway context is unavailable',
    'gateway_context_unavailable',
  );
}

/**
 * Verifies short-lived tenant authority created only after gateway authentication.
 * The legacy browser-selectable `x-workspace-id` header is intentionally ignored.
 */
function requireTrustedWorkspaceContext(
  workspaceValue: unknown,
  issuedAtValue: unknown,
  signatureValue: unknown,
  secretValue: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  if (
    typeof secretValue !== 'string' ||
    Buffer.byteLength(secretValue, 'utf8') < MINIMUM_GATEWAY_SECRET_BYTES
  ) {
    return unavailableGatewayContext();
  }
  if (
    typeof workspaceValue !== 'string' ||
    typeof issuedAtValue !== 'string' ||
    typeof signatureValue !== 'string' ||
    !UUID_V4_PATTERN.test(workspaceValue) ||
    !UNIX_SECONDS_PATTERN.test(issuedAtValue) ||
    !BASE64URL_SHA256_PATTERN.test(signatureValue) ||
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds < 0
  ) {
    return invalidGatewayContext();
  }

  const workspaceId = workspaceValue.toLowerCase();
  const issuedAtSeconds = Number(issuedAtValue);
  if (
    !Number.isSafeInteger(issuedAtSeconds) ||
    issuedAtSeconds > nowSeconds + MAXIMUM_FUTURE_SKEW_SECONDS ||
    issuedAtSeconds < nowSeconds - MAXIMUM_CONTEXT_AGE_SECONDS
  ) {
    return invalidGatewayContext();
  }

  const expected = createHmac('sha256', secretValue)
    .update(`life-os.workspace.v1\n${workspaceId}\n${issuedAtValue}`, 'utf8')
    .digest();
  const actual = Buffer.from(signatureValue, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return invalidGatewayContext();
  }
  return workspaceId;
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
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Body() body: unknown,
  ): PreparedPluginEvent {
    try {
      const trustedWorkspaceId = requireTrustedWorkspaceContext(
        workspaceId,
        issuedAt,
        signature,
        process.env.INTEGRATION_GATEWAY_CONTEXT_SECRET,
      );
      return preparePluginEvent(trustedWorkspaceId, body);
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
