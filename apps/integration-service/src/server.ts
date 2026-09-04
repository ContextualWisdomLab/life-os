import 'reflect-metadata';
import {
  startPluginVaultHostedService,
  type PluginVaultHostedNestApplication,
} from './plugin-vault-hosted-bootstrap';
import { createNodePostgresPluginPool } from './plugin-vault-postgres-driver';
import type { PluginVaultOperatorEnvironment } from './plugin-vault-operator-composition';

/** Injectable hosted-service starter keeps entrypoint selection executable without opening sockets. */
export type PluginVaultHostedServiceStarter = typeof startPluginVaultHostedService;

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

if (require.main === module) {
  void startIntegrationService();
}
