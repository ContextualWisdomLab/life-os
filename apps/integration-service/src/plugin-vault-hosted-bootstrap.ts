import type { DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createPluginVaultHostedModule } from './plugin-vault-hosted-module';
import {
  createPluginVaultHostedRuntime,
  PluginVaultHostedRuntimeError,
  type PluginHostedPostgresPoolFactory,
} from './plugin-vault-hosted-runtime';
import type { PluginVaultOperatorEnvironment } from './plugin-vault-operator-composition';

const DEFAULT_INTEGRATION_SERVICE_PORT = 4_107;
const MAXIMUM_TCP_PORT = 65_535;
const PORT_PATTERN = /^(?:[1-9]\d{0,4})$/u;

/** Minimal Nest application surface owned by the hosted Integration bootstrap. */
export interface PluginVaultHostedNestApplication {
  enableShutdownHooks(): void;
  listen(port: number, host: string): Promise<unknown>;
  close(): Promise<void>;
}

/** Injectable application factory keeps startup ordering directly testable. */
export type PluginVaultHostedNestApplicationFactory = (
  module: DynamicModule,
) => Promise<PluginVaultHostedNestApplication>;

/** Requires a bounded environment mapping before startup configuration is read. */
function requireEnvironment(value: unknown): PluginVaultOperatorEnvironment {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginVaultHostedRuntimeError();
  }
  return value as PluginVaultOperatorEnvironment;
}

/** Resolves one canonical listener port before any database or Vault resource is acquired. */
function listenerPort(environment: PluginVaultOperatorEnvironment): number {
  const configured = environment.INTEGRATION_SERVICE_PORT;
  if (configured === undefined) {
    return DEFAULT_INTEGRATION_SERVICE_PORT;
  }
  if (typeof configured !== 'string' || !PORT_PATTERN.test(configured)) {
    throw new PluginVaultHostedRuntimeError();
  }
  const port = Number(configured);
  if (!Number.isSafeInteger(port) || port < 1 || port > MAXIMUM_TCP_PORT) {
    throw new PluginVaultHostedRuntimeError();
  }
  return port;
}

/** Default Nest application construction over the runtime-owning dynamic module. */
async function createNestApplication(
  module: DynamicModule,
): Promise<PluginVaultHostedNestApplication> {
  return NestFactory.create(module);
}

/**
 * Starts the authenticated Plugin/Vault hosted service in dependency-safe order.
 *
 * Listener configuration is validated first. The Integration-owned PostgreSQL
 * runtime and Vault-backed operator are then fully composed before Nest creates
 * the HTTP application, and that runtime is registered through the lifecycle-owning
 * module before `listen` executes. Startup failure closes both Nest state (when it
 * exists) and the idempotent runtime, so no acquired PostgreSQL pool is orphaned.
 *
 * A concrete PostgreSQL driver factory is deliberately supplied by the deployment
 * composition root; this boundary does not reach into another service's pool or
 * persistence implementation.
 */
export async function startPluginVaultHostedService(
  createPool: PluginHostedPostgresPoolFactory,
  environmentInput: PluginVaultOperatorEnvironment = process.env,
  createApplication: PluginVaultHostedNestApplicationFactory = createNestApplication,
): Promise<PluginVaultHostedNestApplication> {
  if (typeof createApplication !== 'function') {
    throw new PluginVaultHostedRuntimeError();
  }
  const environment = requireEnvironment(environmentInput);
  const port = listenerPort(environment);
  const runtime = await createPluginVaultHostedRuntime(createPool, environment);
  let app: PluginVaultHostedNestApplication | undefined;

  try {
    app = await createApplication(createPluginVaultHostedModule(runtime));
    if (
      app === null ||
      typeof app !== 'object' ||
      typeof app.enableShutdownHooks !== 'function' ||
      typeof app.listen !== 'function' ||
      typeof app.close !== 'function'
    ) {
      throw new PluginVaultHostedRuntimeError();
    }
    app.enableShutdownHooks();
    await app.listen(port, '0.0.0.0');
    return app;
  } catch {
    if (app && typeof app.close === 'function') {
      try {
        await app.close();
      } catch {
        // Runtime cleanup below remains authoritative when Nest cleanup fails.
      }
    }
    try {
      await runtime.close();
    } catch {
      // Startup collapses cleanup detail into the same credential-free failure.
    }
    throw new PluginVaultHostedRuntimeError();
  }
}
