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

/** Untrusted request identity that must match the exact protected Integration route. */
export interface IntegrationTrustedRequestBinding {
  readonly method: string;
  readonly path: string;
}

/** Untrusted gateway headers used only after cryptographic verification. */
export interface IntegrationTrustedWorkspaceHeaders {
  readonly workspaceId: unknown;
  readonly issuedAt: unknown;
  readonly signature: unknown;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNIX_SECONDS_PATTERN = /^(?:0|[1-9]\d{0,12})$/u;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MINIMUM_GATEWAY_SECRET_BYTES = 32;
const MAXIMUM_CONTEXT_AGE_SECONDS = 60;
const MAXIMUM_FUTURE_SKEW_SECONDS = 5;
const EVENT_PREPARE_BINDING = Object.freeze({
  method: 'POST',
  path: '/v1/events/prepare',
});

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
 * Verifies short-lived tenant authority bound to the exact event-preparation
 * method and path. Workspace-only v1 signatures and non-canonical signatures
 * are rejected so this proof cannot be replayed as future Integration authority.
 */
export function requireTrustedEventWorkspaceContext(
  headers: IntegrationTrustedWorkspaceHeaders,
  secretValue: unknown,
  requestBinding: IntegrationTrustedRequestBinding,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  if (
    typeof secretValue !== 'string' ||
    Buffer.byteLength(secretValue, 'utf8') < MINIMUM_GATEWAY_SECRET_BYTES ||
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds < 0
  ) {
    return unavailableGatewayContext();
  }
  if (
    requestBinding.method !== EVENT_PREPARE_BINDING.method ||
    requestBinding.path !== EVENT_PREPARE_BINDING.path ||
    typeof headers.workspaceId !== 'string' ||
    typeof headers.issuedAt !== 'string' ||
    typeof headers.signature !== 'string' ||
    !UUID_V4_PATTERN.test(headers.workspaceId) ||
    !UNIX_SECONDS_PATTERN.test(headers.issuedAt) ||
    !BASE64URL_SHA256_PATTERN.test(headers.signature)
  ) {
    return invalidGatewayContext();
  }

  const workspaceId = headers.workspaceId.toLowerCase();
  const issuedAtSeconds = Number(headers.issuedAt);
  if (
    !Number.isSafeInteger(issuedAtSeconds) ||
    issuedAtSeconds > nowSeconds + MAXIMUM_FUTURE_SKEW_SECONDS ||
    issuedAtSeconds < nowSeconds - MAXIMUM_CONTEXT_AGE_SECONDS
  ) {
    return invalidGatewayContext();
  }

  const actual = Buffer.from(headers.signature, 'base64url');
  if (actual.toString('base64url') !== headers.signature) {
    return invalidGatewayContext();
  }
  const expected = createHmac('sha256', secretValue)
    .update(
      `life-os.integration-event-context.v2\n${workspaceId}\n${headers.issuedAt}\n${requestBinding.method}\n${requestBinding.path}`,
      'utf8',
    )
    .digest();
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
      const trustedWorkspaceId = requireTrustedEventWorkspaceContext(
        { workspaceId, issuedAt, signature },
        process.env.INTEGRATION_GATEWAY_CONTEXT_SECRET,
        EVENT_PREPARE_BINDING,
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
