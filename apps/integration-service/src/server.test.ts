import { describe, expect, it, vi } from 'vitest';
import type { PluginVaultHostedNestApplication } from './plugin-vault-hosted-bootstrap';
import { createNodePostgresPluginPool } from './plugin-vault-postgres-driver';
import {
  runIntegrationServiceEntrypoint,
  startIntegrationService,
} from './server';

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

  it('leaves the process failure surface untouched after successful startup', async () => {
    const application = {} as PluginVaultHostedNestApplication;
    const startHosted = vi.fn(async () => application);
    const writes: string[] = [];
    const runtime = {
      exitCode: undefined as number | undefined,
      stderr: {
        write(chunk: string): boolean {
          writes.push(chunk);
          return true;
        },
      },
    };

    await runIntegrationServiceEntrypoint(environment, startHosted, runtime);

    expect(startHosted).toHaveBeenCalledTimes(1);
    expect(runtime.exitCode).toBeUndefined();
    expect(writes).toEqual([]);
  });

  it('turns startup rejection into one credential-free nonzero process failure', async () => {
    const vaultToken = 'vault-token-that-must-never-enter-startup-output';
    const startupEnvironment = Object.freeze({
      ...environment,
      INTEGRATION_PLUGIN_VAULT_TOKEN: vaultToken,
    });
    const startHosted = vi.fn(async () => {
      throw new Error(`provider detail leaked ${vaultToken}`);
    });
    const writes: string[] = [];
    const runtime = {
      exitCode: undefined as number | undefined,
      stderr: {
        write(chunk: string): boolean {
          writes.push(chunk);
          return true;
        },
      },
    };

    await runIntegrationServiceEntrypoint(
      startupEnvironment,
      startHosted,
      runtime,
    );

    expect(runtime.exitCode).toBe(1);
    expect(writes).toEqual(['Integration service startup failed.\n']);
    expect(writes.join('')).not.toContain(vaultToken);
  });

  it('still sets a nonzero exit code when stderr itself is unavailable', async () => {
    const startHosted = vi.fn(async () => {
      throw new Error('startup failed');
    });
    const runtime = {
      exitCode: undefined as number | undefined,
      stderr: {
        write(): never {
          throw new Error('stderr unavailable');
        },
      },
    };

    await expect(
      runIntegrationServiceEntrypoint(environment, startHosted, runtime),
    ).resolves.toBeUndefined();
    expect(runtime.exitCode).toBe(1);
  });
});
