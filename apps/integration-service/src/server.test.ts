import { describe, expect, it, vi } from 'vitest';
import type { PluginVaultHostedNestApplication } from './plugin-vault-hosted-bootstrap';
import { createNodePostgresPluginPool } from './plugin-vault-postgres-driver';
import { startIntegrationService } from './server';

const environment = Object.freeze({
  INTEGRATION_DATABASE_URL: 'postgresql://integration.example.test/life_os',
  INTEGRATION_OPERATOR_CONTEXT_SECRET: 'operator-context-fixture-value-32-bytes-minimum',
  INTEGRATION_PLUGIN_VAULT_ORIGIN: 'https://vault.example.test',
  INTEGRATION_PLUGIN_VAULT_TOKEN: 'vault-fixture-token-value',
  INTEGRATION_PLUGIN_VAULT_MOUNT: 'secret',
});

describe('Integration service production entrypoint', () => {
  it('selects the Integration-owned node-postgres factory for hosted Plugin composition', async () => {
    const application = {} as PluginVaultHostedNestApplication;
    const startHosted = vi.fn(async () => application);

    const result = await startIntegrationService(environment, startHosted);

    expect(startHosted).toHaveBeenCalledTimes(1);
    expect(startHosted).toHaveBeenCalledWith(
      createNodePostgresPluginPool,
      environment,
    );
    expect(result).toBe(application);
  });
});
