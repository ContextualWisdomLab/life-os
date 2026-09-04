import { describe, expect, it, vi } from 'vitest';
import type { DynamicModule } from '@nestjs/common';
import {
  startPluginVaultHostedService,
  type PluginVaultHostedNestApplication,
} from './plugin-vault-hosted-bootstrap';
import type { PluginHostedPostgresPool } from './plugin-vault-hosted-runtime';

const DATABASE_URL = 'postgresql://runtime.invalid/life_os';
const CONTEXT_SECRET = 'operator-context-fixture-value-32-bytes-minimum';

function environment(): Readonly<Record<string, string | undefined>> {
  return Object.freeze({
    INTEGRATION_DATABASE_URL: DATABASE_URL,
    INTEGRATION_OPERATOR_CONTEXT_SECRET: CONTEXT_SECRET,
    INTEGRATION_PLUGIN_VAULT_ORIGIN: 'https://vault.example.test',
    INTEGRATION_PLUGIN_VAULT_TOKEN: 'vault-fixture-token-value',
    INTEGRATION_PLUGIN_VAULT_MOUNT: 'secret',
    INTEGRATION_SERVICE_PORT: '4107',
  });
}

function pool(): PluginHostedPostgresPool & {
  readonly end: ReturnType<typeof vi.fn>;
} {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    end: vi.fn(async () => undefined),
  };
}

describe('Plugin Vault hosted bootstrap', () => {
  it('composes the runtime into the Nest module before the listener starts', async () => {
    const events: string[] = [];
    const ownedPool = pool();
    const createPool = vi.fn(() => {
      events.push('pool');
      return ownedPool;
    });
    const app: PluginVaultHostedNestApplication = {
      enableShutdownHooks: vi.fn(() => events.push('hooks')),
      listen: vi.fn(async () => {
        events.push('listen');
      }),
      close: vi.fn(async () => undefined),
    };
    const createApplication = vi.fn(async (_module: DynamicModule) => {
      events.push('module');
      return app;
    });

    await startPluginVaultHostedService(
      createPool,
      environment(),
      createApplication,
    );

    expect(events).toEqual(['pool', 'module', 'hooks', 'listen']);
    expect(app.listen).toHaveBeenCalledWith(4107, '0.0.0.0');
    expect(ownedPool.end).not.toHaveBeenCalled();
  });

  it('closes the owned runtime if listener startup fails', async () => {
    const ownedPool = pool();
    const app: PluginVaultHostedNestApplication = {
      enableShutdownHooks: vi.fn(),
      listen: vi.fn(async () => {
        throw new Error('listener fixture failure');
      }),
      close: vi.fn(async () => undefined),
    };

    await expect(
      startPluginVaultHostedService(
        () => ownedPool,
        environment(),
        async () => app,
      ),
    ).rejects.toThrow('Plugin hosted runtime configuration is unavailable');
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(ownedPool.end).toHaveBeenCalledTimes(1);
  });

  it('fails before pool acquisition for a malformed listener port', async () => {
    const createPool = vi.fn(() => pool());

    await expect(
      startPluginVaultHostedService(
        createPool,
        { ...environment(), INTEGRATION_SERVICE_PORT: '0' },
        async () => {
          throw new Error('application factory must not run');
        },
      ),
    ).rejects.toThrow('Plugin hosted runtime configuration is unavailable');
    expect(createPool).not.toHaveBeenCalled();
  });
});
