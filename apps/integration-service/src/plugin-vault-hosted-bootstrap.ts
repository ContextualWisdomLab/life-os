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

interface AcceptedNestApplication {
  readonly application: PluginVaultHostedNestApplication;
  enableShutdownHooks(): void;
  listen(port: number, host: string): Promise<unknown>;
  close(): Promise<void>;
}

/** Requires a bounded environment mapping before startup configuration is read. */
function requireEnvironment(value: unknown): PluginVaultOperatorEnvironment {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginVaultHostedRuntimeError();
  }
  return value as PluginVaultOperatorEnvironment;
}

/** Resolves one canonical listener port before any database or Vault resource is acquired. */
function listenerPort(environment: PluginVaultOperatorEnvironment): number {
  let configured: unknown;
  try {
    configured = environment.INTEGRATION_SERVICE_PORT;
  } catch {
    throw new PluginVaultHostedRuntimeError();
  }
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

/** Captures one stable Nest lifecycle surface before listener authority is exercised. */
function requireApplication(value: unknown): AcceptedNestApplication {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginVaultHostedRuntimeError();
  }

  let enableShutdownHooks: unknown;
  let listen: unknown;
  let close: unknown;
  try {
    enableShutdownHooks = (value as PluginVaultHostedNestApplication)
      .enableShutdownHooks;
    listen = (value as PluginVaultHostedNestApplication).listen;
    close = (value as PluginVaultHostedNestApplication).close;
  } catch {
    throw new PluginVaultHostedRuntimeError();
  }
  if (
    typeof enableShutdownHooks !== 'function' ||
    typeof listen !== 'function' ||
    typeof close !== 'function'
  ) {
    throw new PluginVaultHostedRuntimeError();
  }

  const application = value as PluginVaultHostedNestApplication;
  return Object.freeze({
    application,
    enableShutdownHooks(): void {
      Reflect.apply(enableShutdownHooks, application, []);
    },
    listen(port: number, host: string): Promise<unknown> {
      return Reflect.apply(listen, application, [port, host]) as Promise<unknown>;
    },
    close(): Promise<void> {
      return Reflect.apply(close, application, []) as Promise<void>;
    },
  });
}

/** Best-effort cleanup when application validation failed before method capture completed. */
async function closeUnacceptedApplication(value: unknown): Promise<void> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }

  let close: unknown;
  try {
    close = (value as { close?: unknown }).close;
  } catch {
    return;
  }
  if (typeof close !== 'function') {
    return;
  }
  try {
    await Reflect.apply(close, value, []);
  } catch {
    // Runtime cleanup remains authoritative after a malformed Nest application.
  }
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
 * Environment and Nest application properties are untrusted runtime evidence. The
 * bootstrap therefore bounds property access and captures accepted lifecycle methods
 * once before they can authorize hook registration, listener start, or cleanup.
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
  let applicationValue: unknown;
  let acceptedApplication: AcceptedNestApplication | undefined;

  try {
    applicationValue = await createApplication(createPluginVaultHostedModule(runtime));
    acceptedApplication = requireApplication(applicationValue);
    acceptedApplication.enableShutdownHooks();
    await acceptedApplication.listen(port, '0.0.0.0');
    return acceptedApplication.application;
  } catch {
    if (acceptedApplication !== undefined) {
      try {
        await acceptedApplication.close();
      } catch {
        // Runtime cleanup below remains authoritative when Nest cleanup fails.
      }
    } else {
      await closeUnacceptedApplication(applicationValue);
    }
    try {
      await runtime.close();
    } catch {
      // Startup collapses cleanup detail into the same credential-free failure.
    }
    throw new PluginVaultHostedRuntimeError();
  }
}
