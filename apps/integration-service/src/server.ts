import 'reflect-metadata';
import {
  startPluginVaultHostedService,
  type PluginVaultHostedNestApplication,
} from './plugin-vault-hosted-bootstrap';
import { createNodePostgresPluginPool } from './plugin-vault-postgres-driver';
import type { PluginVaultOperatorEnvironment } from './plugin-vault-operator-composition';

/** Injectable hosted-service starter keeps entrypoint selection executable without opening sockets. */
export type PluginVaultHostedServiceStarter = typeof startPluginVaultHostedService;

/** Minimal process surface used to make startup failure behavior executable without terminating tests. */
export interface IntegrationServiceEntrypointRuntime {
  stderr: {
    write(chunk: string): unknown;
  };
  exitCode?: number;
}

/**
 * Starts the production Integration service through the authenticated Plugin/Vault runtime.
 *
 * The production path supplies the Integration-owned node-postgres factory explicitly. The
 * hosted runtime remains the sole reader of `INTEGRATION_DATABASE_URL`, so node-postgres cannot
 * silently fall back to libpq-style generic process environment authority. The injectable starter
 * exists only to keep entrypoint selection executable without opening PostgreSQL/Vault sockets.
 */
export async function startIntegrationService(
  environment: PluginVaultOperatorEnvironment = process.env,
  startHosted: PluginVaultHostedServiceStarter = startPluginVaultHostedService,
): Promise<PluginVaultHostedNestApplication> {
  return await startHosted(createNodePostgresPluginPool, environment);
}

/**
 * Runs the executable entrypoint with a bounded, credential-free startup failure surface.
 *
 * Hosted composition already translates dependency/configuration failures into bounded errors,
 * but the process boundary must still consume a rejected startup promise. Otherwise a rejected
 * `void startIntegrationService()` becomes an unhandled rejection and Node decides process
 * termination/log rendering outside the service contract. The original error is deliberately not
 * interpolated because provider/database configuration can contain secret material.
 */
export async function runIntegrationServiceEntrypoint(
  environment: PluginVaultOperatorEnvironment = process.env,
  startHosted: PluginVaultHostedServiceStarter = startPluginVaultHostedService,
  runtime: IntegrationServiceEntrypointRuntime = process,
): Promise<void> {
  try {
    await startIntegrationService(environment, startHosted);
  } catch {
    try {
      runtime.stderr.write('Integration service startup failed.\n');
    } catch {
      // stderr failure must not restore an unhandled startup rejection path.
    }
    runtime.exitCode = 1;
  }
}

if (require.main === module) {
  void runIntegrationServiceEntrypoint();
}
