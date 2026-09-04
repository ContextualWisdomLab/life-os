import type { DynamicModule } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  startPluginVaultHostedService,
  type PluginVaultHostedNestApplication,
  type PluginVaultHostedNestApplicationFactory,
} from './plugin-vault-hosted-bootstrap';
import {
  PluginVaultHostedRuntimeError,
  type PluginHostedPostgresPool,
} from './plugin-vault-hosted-runtime';

const DATABASE_URL = 'postgresql://runtime.invalid/life_os';
const CONTEXT_SECRET = 'operator-context-fixture-value-32-bytes-minimum';

function environment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  return Object.freeze({
    INTEGRATION_DATABASE_URL: DATABASE_URL,
    INTEGRATION_OPERATOR_CONTEXT_SECRET: CONTEXT_SECRET,
    INTEGRATION_PLUGIN_VAULT_ORIGIN: 'https://vault.example.test',
    INTEGRATION_PLUGIN_VAULT_TOKEN: 'vault-fixture-token-value',
    INTEGRATION_PLUGIN_VAULT_MOUNT: 'secret',
    INTEGRATION_SERVICE_PORT: '4107',
    ...overrides,
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

function app(
  overrides: Partial<PluginVaultHostedNestApplication> = {},
): PluginVaultHostedNestApplication & {
  readonly enableShutdownHooks: ReturnType<typeof vi.fn>;
  readonly listen: ReturnType<typeof vi.fn>;
  readonly close: ReturnType<typeof vi.fn>;
} {
  return {
    enableShutdownHooks: vi.fn(),
    listen: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  } as PluginVaultHostedNestApplication & {
    readonly enableShutdownHooks: ReturnType<typeof vi.fn>;
    readonly listen: ReturnType<typeof vi.fn>;
    readonly close: ReturnType<typeof vi.fn>;
  };
}

async function expectBootstrapFailure(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(PluginVaultHostedRuntimeError);
}

describe('Plugin Vault hosted bootstrap', () => {
  it.each([null, undefined, 'invalid', []])(
    'rejects malformed environment envelope %j before pool acquisition',
    async (malformed) => {
      const createPool = vi.fn(() => pool());
      await expectBootstrapFailure(
        startPluginVaultHostedService(
          createPool,
          malformed as unknown as Readonly<Record<string, string | undefined>>,
          async () => app(),
        ),
      );
      expect(createPool).not.toHaveBeenCalled();
    },
  );

  it.each(['0', '65536', '01', '-1', 'not-a-port'])(
    'fails before pool acquisition for malformed listener port %s',
    async (port) => {
      const createPool = vi.fn(() => pool());

      await expectBootstrapFailure(
        startPluginVaultHostedService(
          createPool,
          environment({ INTEGRATION_SERVICE_PORT: port }),
          async () => app(),
        ),
      );
      expect(createPool).not.toHaveBeenCalled();
    },
  );

  it('bounds a throwing listener-port accessor before pool acquisition', async () => {
    const createPool = vi.fn(() => pool());
    const env = Object.create(null) as Record<string, string | undefined>;
    Object.assign(env, environment({ INTEGRATION_SERVICE_PORT: undefined }));
    Object.defineProperty(env, 'INTEGRATION_SERVICE_PORT', {
      enumerable: true,
      get() {
        throw new Error('listener accessor fixture secret');
      },
    });

    await expectBootstrapFailure(
      startPluginVaultHostedService(createPool, env, async () => app()),
    );
    expect(createPool).not.toHaveBeenCalled();
  });

  it('uses the bounded default listener port when the service port is absent', async () => {
    const ownedPool = pool();
    const hostedApp = app();

    await startPluginVaultHostedService(
      () => ownedPool,
      environment({ INTEGRATION_SERVICE_PORT: undefined }),
      async () => hostedApp,
    );

    expect(hostedApp.listen).toHaveBeenCalledWith(4107, '0.0.0.0');
  });

  it('rejects a malformed application factory before pool acquisition', async () => {
    const createPool = vi.fn(() => pool());

    await expectBootstrapFailure(
      startPluginVaultHostedService(
        createPool,
        environment(),
        null as unknown as PluginVaultHostedNestApplicationFactory,
      ),
    );
    expect(createPool).not.toHaveBeenCalled();
  });

  it('composes the runtime into the Nest module before the listener starts', async () => {
    const events: string[] = [];
    const ownedPool = pool();
    const createPool = vi.fn(() => {
      events.push('pool');
      return ownedPool;
    });
    const hostedApp = app({
      enableShutdownHooks: vi.fn(() => events.push('hooks')),
      listen: vi.fn(async () => {
        events.push('listen');
      }),
    });
    const createApplication = vi.fn(async (_module: DynamicModule) => {
      events.push('module');
      return hostedApp;
    });

    await startPluginVaultHostedService(
      createPool,
      environment(),
      createApplication,
    );

    expect(events).toEqual(['pool', 'module', 'hooks', 'listen']);
    expect(hostedApp.listen).toHaveBeenCalledWith(4107, '0.0.0.0');
    expect(ownedPool.end).not.toHaveBeenCalled();
  });

  it('closes the runtime when application construction rejects', async () => {
    const ownedPool = pool();

    await expectBootstrapFailure(
      startPluginVaultHostedService(
        () => ownedPool,
        environment(),
        async () => {
          throw new Error('application factory fixture secret');
        },
      ),
    );
    expect(ownedPool.end).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    {},
    { enableShutdownHooks: vi.fn(), listen: vi.fn(), close: null },
  ])('closes the runtime for malformed application envelope %j', async (malformed) => {
    const ownedPool = pool();

    await expectBootstrapFailure(
      startPluginVaultHostedService(
        () => ownedPool,
        environment(),
        async () => malformed as unknown as PluginVaultHostedNestApplication,
      ),
    );
    expect(ownedPool.end).toHaveBeenCalledTimes(1);
  });

  it('bounds a throwing application cleanup accessor and still closes the runtime', async () => {
    const ownedPool = pool();
    const malformed = {
      enableShutdownHooks: vi.fn(),
      listen: vi.fn(async () => undefined),
      get close(): never {
        throw new Error('application close accessor fixture secret');
      },
    } as unknown as PluginVaultHostedNestApplication;

    await expectBootstrapFailure(
      startPluginVaultHostedService(
        () => ownedPool,
        environment(),
        async () => malformed,
      ),
    );
    expect(ownedPool.end).toHaveBeenCalledTimes(1);
  });

  it('closes application and runtime if shutdown-hook registration throws', async () => {
    const ownedPool = pool();
    const hostedApp = app({
      enableShutdownHooks: vi.fn(() => {
        throw new Error('hook fixture failure');
      }),
    });

    await expectBootstrapFailure(
      startPluginVaultHostedService(
        () => ownedPool,
        environment(),
        async () => hostedApp,
      ),
    );
    expect(hostedApp.close).toHaveBeenCalledTimes(1);
    expect(ownedPool.end).toHaveBeenCalledTimes(1);
  });

  it('closes the owned runtime if listener startup fails', async () => {
    const ownedPool = pool();
    const hostedApp = app({
      listen: vi.fn(async () => {
        throw new Error('listener fixture failure');
      }),
    });

    await expectBootstrapFailure(
      startPluginVaultHostedService(
        () => ownedPool,
        environment(),
        async () => hostedApp,
      ),
    );
    expect(hostedApp.close).toHaveBeenCalledTimes(1);
    expect(ownedPool.end).toHaveBeenCalledTimes(1);
  });

  it('still closes the runtime when application cleanup also fails', async () => {
    const ownedPool = pool();
    const hostedApp = app({
      listen: vi.fn(async () => {
        throw new Error('listener fixture failure');
      }),
      close: vi.fn(async () => {
        throw new Error('application cleanup fixture failure');
      }),
    });

    await expectBootstrapFailure(
      startPluginVaultHostedService(
        () => ownedPool,
        environment(),
        async () => hostedApp,
      ),
    );
    expect(hostedApp.close).toHaveBeenCalledTimes(1);
    expect(ownedPool.end).toHaveBeenCalledTimes(1);
  });

  it('keeps startup failure bounded when runtime cleanup rejects', async () => {
    const ownedPool = pool();
    ownedPool.end.mockRejectedValueOnce(new Error('pool cleanup fixture failure'));
    const hostedApp = app({
      listen: vi.fn(async () => {
        throw new Error('listener fixture failure');
      }),
    });

    await expectBootstrapFailure(
      startPluginVaultHostedService(
        () => ownedPool,
        environment(),
        async () => hostedApp,
      ),
    );
    expect(ownedPool.end).toHaveBeenCalledTimes(1);
  });
});
