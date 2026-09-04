import { NestFactory } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { PluginOperatorApplication } from './plugin-operator-application';
import {
  createPluginVaultHostedModule,
  PLUGIN_VAULT_HOSTED_RUNTIME,
} from './plugin-vault-hosted-module';
import {
  PluginVaultHostedRuntimeError,
  type PluginVaultHostedRuntime,
} from './plugin-vault-hosted-runtime';
import { PLUGIN_OPERATOR_APPLICATION } from './main';

describe('Integration hosted Plugin runtime module', () => {
  it.each([
    null,
    undefined,
    {},
    { operator: null, close: vi.fn() },
    { operator: {}, close: null },
    { operator: {}, close: vi.fn(async () => undefined) },
  ])('rejects malformed runtime envelope %j', (malformed) => {
    expect(() =>
      createPluginVaultHostedModule(
        malformed as unknown as PluginVaultHostedRuntime,
      ),
    ).toThrow(PluginVaultHostedRuntimeError);
  });

  it.each(['operator', 'close'] as const)(
    'bounds a throwing runtime %s accessor before module authority is registered',
    (property) => {
      const runtime = {
        operator: {} as PluginOperatorApplication,
        close: vi.fn(async () => undefined),
      } as Record<string, unknown>;
      Object.defineProperty(runtime, property, {
        enumerable: true,
        get() {
          throw new Error(`${property} accessor fixture secret`);
        },
      });

      expect(() =>
        createPluginVaultHostedModule(
          runtime as unknown as PluginVaultHostedRuntime,
        ),
      ).toThrow(PluginVaultHostedRuntimeError);
    },
  );

  it('captures shutdown authority once instead of rereading a stateful close accessor', async () => {
    const acceptedClose = vi.fn(async () => undefined);
    const replacementClose = vi.fn(async () => undefined);
    let reads = 0;
    const operator = {} as PluginOperatorApplication;
    const runtime = {
      operator,
      get close() {
        reads += 1;
        return reads === 1 ? acceptedClose : replacementClose;
      },
    } as PluginVaultHostedRuntime;

    const app = await NestFactory.createApplicationContext(
      createPluginVaultHostedModule(runtime),
      { logger: false },
    );

    await app.close();
    expect(reads).toBe(1);
    expect(acceptedClose).toHaveBeenCalledTimes(1);
    expect(replacementClose).not.toHaveBeenCalled();
  });

  it('registers the composed operator and closes its owned runtime exactly once on application shutdown', async () => {
    const close = vi.fn(async () => undefined);
    const operator = {} as PluginOperatorApplication;
    const runtime: PluginVaultHostedRuntime = { operator, close };

    const app = await NestFactory.createApplicationContext(
      createPluginVaultHostedModule(runtime),
      { logger: false },
    );

    expect(app.get(PLUGIN_OPERATOR_APPLICATION)).toBe(operator);
    expect(app.get(PLUGIN_VAULT_HOSTED_RUNTIME).operator).toBe(operator);

    await app.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
