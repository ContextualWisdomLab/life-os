import 'reflect-metadata';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Catch,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Module,
  Optional,
  Param,
  Post,
  type ArgumentsHost,
  type DynamicModule,
  type ExceptionFilter,
} from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import {
  getPluginContractDiscovery,
  type PluginContractDiscovery,
  PluginContractError,
  type PluginManifest,
  type PreparedPluginEvent,
  preparePluginEvent,
  validatePluginManifest,
} from '@life-os/plugin-sdk';
import {
  PluginOperatorApplication,
  PluginOperatorDependencyError,
  type PluginOperatorCredentialInput,
  type PluginOperatorInstallInput,
} from './plugin-operator-application';
import {
  IntegrationOperatorContextError,
  type IntegrationOperatorContextHeaders,
} from './plugin-operator-context';
import {
  PluginInstallationError,
  type PluginInstallationRecord,
} from './plugin-installation';
import {
  PluginCredentialError,
  type PluginCredentialBindingView,
} from './plugin-credential';

type IntegrationProblemCode =
  | 'invalid_plugin_contract'
  | 'invalid_gateway_context'
  | 'gateway_context_unavailable'
  | 'plugin_operator_unavailable'
  | 'invalid_plugin_operator_context'
  | 'plugin_operator_context_unavailable'
  | 'invalid_plugin_operator_request'
  | 'plugin_operator_not_found'
  | 'plugin_credential_capability_unavailable'
  | 'plugin_operator_failure';

interface IntegrationProblemDetails {
  readonly type: 'about:blank';
  readonly title: string;
  readonly status: number;
  readonly code: IntegrationProblemCode;
}

interface IntegrationHttpRequest {
  readonly originalUrl?: string;
  readonly url?: string;
}

interface IntegrationHttpResponse {
  status(statusCode: number): IntegrationHttpResponse;
  json(body: unknown): void;
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

/** Optional host composition token for the durable plugin operator application. */
export const PLUGIN_OPERATOR_APPLICATION = Symbol(
  'life-os.integration.plugin-operator-application',
);

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

function unavailablePluginOperator(): never {
  throw problemException(
    503,
    'Plugin operator runtime is unavailable',
    'plugin_operator_unavailable',
  );
}

function invalidPluginOperatorContext(): never {
  throw problemException(
    401,
    'Plugin operator context is invalid',
    'invalid_plugin_operator_context',
  );
}

function unavailablePluginOperatorContext(): never {
  throw problemException(
    503,
    'Plugin operator context is unavailable',
    'plugin_operator_context_unavailable',
  );
}

function invalidPluginOperatorRequest(): never {
  throw problemException(
    400,
    'Plugin operator request is invalid',
    'invalid_plugin_operator_request',
  );
}

function missingPluginOperatorRecord(): never {
  throw problemException(
    404,
    'Plugin operator resource was not found',
    'plugin_operator_not_found',
  );
}

function unavailablePluginCredentialCapability(): never {
  throw problemException(
    503,
    'Plugin credential capability is unavailable',
    'plugin_credential_capability_unavailable',
  );
}

function pluginOperatorFailure(): never {
  throw problemException(
    503,
    'Plugin operator request could not be completed',
    'plugin_operator_failure',
  );
}

function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidPluginOperatorRequest();
  }
  return value as Record<string, unknown>;
}

/** Returns true only for the bounded plugin-operator lifecycle route family. */
function isPluginOperatorPath(path: string): boolean {
  return (
    path === '/v1/plugins/installations' ||
    path.startsWith('/v1/plugins/installations/') ||
    path === '/v1/plugins/credential-bindings' ||
    path.startsWith('/v1/plugins/credential-bindings/')
  );
}

/**
 * Normalizes framework/body-parser 400s on operator routes into the same fixed,
 * credential-free problem contract used by controller-level input validation.
 */
@Catch(BadRequestException)
class IntegrationBadRequestFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<IntegrationHttpRequest>();
    const response = http.getResponse<IntegrationHttpResponse>();
    const path = (request.originalUrl ?? request.url ?? '').split('?', 1)[0] ?? '';

    if (isPluginOperatorPath(path)) {
      response.status(400).json({
        type: 'about:blank',
        title: 'Plugin operator request is invalid',
        status: 400,
        code: 'invalid_plugin_operator_request',
      } satisfies IntegrationProblemDetails);
      return;
    }

    response.status(exception.getStatus()).json(exception.getResponse());
  }
}

/** Selects only operator-owned installation fields from an untrusted HTTP body. */
function pluginOperatorInstallInput(body: unknown): PluginOperatorInstallInput {
  const value = requireObject(body);
  return Object.freeze({
    installationId: value.installationId as string,
    manifest: value.manifest as PluginManifest,
    grantedCapabilities: value.grantedCapabilities as readonly string[],
  });
}

/** Selects only operator-owned credential fields from an untrusted HTTP body. */
function pluginOperatorCredentialInput(
  body: unknown,
): PluginOperatorCredentialInput {
  const value = requireObject(body);
  return Object.freeze({
    credentialBindingId: value.credentialBindingId as string,
    installationId: value.installationId as string,
    credentialName: value.credentialName as string,
    secretValue: value.secretValue as string,
  });
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

/**
 * HTTP transport for the host-owned plugin installation and credential lifecycle.
 *
 * The controller never derives tenant or user authority from route/body data. It
 * forwards signed gateway evidence to `PluginOperatorApplication`, which verifies
 * the exact method/path binding and atomically consumes the one-time evidence
 * before any durable lifecycle authority is invoked. A standalone deployment
 * without a durable operator composition exposes the routes fail-closed as 503.
 */
@Controller()
export class PluginOperatorHttpController {
  /** Receives a durable host composition when one is explicitly registered. */
  constructor(
    @Optional()
    @Inject(PLUGIN_OPERATOR_APPLICATION)
    private readonly operator?: PluginOperatorApplication,
  ) {}

  /** Installs a plugin under signed workspace-and-user authority. */
  @Post('v1/plugins/installations')
  @HttpCode(200)
  async install(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-user-id') userId: string | undefined,
    @Headers('x-life-os-context-evidence-id') evidenceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Body() body: unknown,
  ): Promise<PluginInstallationRecord> {
    const operator = this.requireOperator();
    try {
      return await operator.install(
        this.headers(workspaceId, userId, evidenceId, issuedAt, signature),
        pluginOperatorInstallInput(body),
      );
    } catch (error) {
      return this.classify(error);
    }
  }

  /** Reads one installation under its exact signed dynamic route authority. */
  @Get('v1/plugins/installations/:installationId')
  async getInstallation(
    @Param('installationId') installationId: string,
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-user-id') userId: string | undefined,
    @Headers('x-life-os-context-evidence-id') evidenceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
  ): Promise<PluginInstallationRecord> {
    const operator = this.requireOperator();
    try {
      const record = await operator.getInstallation(
        this.headers(workspaceId, userId, evidenceId, issuedAt, signature),
        installationId,
      );
      return record ?? missingPluginOperatorRecord();
    } catch (error) {
      return this.classify(error);
    }
  }

  /** Revokes one installation under its exact signed dynamic route authority. */
  @Post('v1/plugins/installations/:installationId/revoke')
  @HttpCode(200)
  async revokeInstallation(
    @Param('installationId') installationId: string,
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-user-id') userId: string | undefined,
    @Headers('x-life-os-context-evidence-id') evidenceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
  ): Promise<PluginInstallationRecord> {
    const operator = this.requireOperator();
    try {
      return await operator.revokeInstallation(
        this.headers(workspaceId, userId, evidenceId, issuedAt, signature),
        installationId,
      );
    } catch (error) {
      return this.classify(error);
    }
  }

  /** Binds one credential while returning only the secret-reference-free public view. */
  @Post('v1/plugins/credential-bindings')
  @HttpCode(200)
  async bindCredential(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-user-id') userId: string | undefined,
    @Headers('x-life-os-context-evidence-id') evidenceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Body() body: unknown,
  ): Promise<PluginCredentialBindingView> {
    const operator = this.requireOperator();
    try {
      return await operator.bindCredential(
        this.headers(workspaceId, userId, evidenceId, issuedAt, signature),
        pluginOperatorCredentialInput(body),
      );
    } catch (error) {
      return this.classify(error);
    }
  }

  /** Revokes one credential binding under its exact signed route authority. */
  @Post('v1/plugins/credential-bindings/:credentialBindingId/revoke')
  @HttpCode(200)
  async revokeCredential(
    @Param('credentialBindingId') credentialBindingId: string,
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-user-id') userId: string | undefined,
    @Headers('x-life-os-context-evidence-id') evidenceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
  ): Promise<PluginCredentialBindingView> {
    const operator = this.requireOperator();
    try {
      return await operator.revokeCredential(
        this.headers(workspaceId, userId, evidenceId, issuedAt, signature),
        credentialBindingId,
      );
    } catch (error) {
      return this.classify(error);
    }
  }

  /** Requires a deliberately composed durable runtime; absence never creates fake success. */
  private requireOperator(): PluginOperatorApplication {
    return this.operator ?? unavailablePluginOperator();
  }

  /** Builds untrusted header evidence without accepting tenant/user authority from request bodies. */
  private headers(
    workspaceId: unknown,
    userId: unknown,
    evidenceId: unknown,
    issuedAt: unknown,
    signature: unknown,
  ): IntegrationOperatorContextHeaders {
    return Object.freeze({ workspaceId, userId, evidenceId, issuedAt, signature });
  }

  /** Converts domain/dependency failures to fixed, credential-free HTTP problems. */
  private classify(error: unknown): never {
    if (error instanceof HttpException) {
      throw error;
    }
    if (error instanceof IntegrationOperatorContextError) {
      return error.kind === 'invalid'
        ? invalidPluginOperatorContext()
        : unavailablePluginOperatorContext();
    }
    if (error instanceof PluginOperatorDependencyError) {
      return unavailablePluginCredentialCapability();
    }
    if (
      error instanceof PluginInstallationError ||
      error instanceof PluginCredentialError
    ) {
      return invalidPluginOperatorRequest();
    }
    return pluginOperatorFailure();
  }
}

@Module({
  controllers: [IntegrationController, PluginOperatorHttpController],
  providers: [{ provide: APP_FILTER, useClass: IntegrationBadRequestFilter }],
})
export class IntegrationAppModule {
  /** Registers an explicitly constructed durable plugin operator for host deployments. */
  static withPluginOperator(operator: PluginOperatorApplication): DynamicModule {
    return {
      module: IntegrationAppModule,
      providers: [{ provide: PLUGIN_OPERATOR_APPLICATION, useValue: operator }],
    };
  }
}

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
