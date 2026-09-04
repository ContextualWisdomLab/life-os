import { NestFactory } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { PluginOperatorApplication } from './plugin-operator-application';
import {
  createPluginVaultHostedModule,
  PLUGIN_VAULT_HOSTED_RUNTIME,
} from './plugin-vault-hosted-module';
import type { PluginVaultHostedRuntime } from './plugin-vault-hosted-runtime';
import { PLUGIN_OPERATOR_APPLICATION } from './main';

describe('Integration hosted Plugin runtime module', () => {
  it('registers the composed operator and closes its owned runtime exactly once on application shutdown', async () => {
    const close = vi.fn(async () => undefined);
    const operator = {} as PluginOperatorApplication;
    const runtime: PluginVaultHostedRuntime = { operator, close };

    const app = await NestFactory.createApplicationContext(
      createPluginVaultHostedModule(runtime),
      { logger: false },
    );

    expect(app.get(PLUGIN_OPERATOR_APPLICATION)).toBe(operator);
    expect(app.get(PLUGIN_VAULT_HOSTED_RUNTIME)).toBe(runtime);

    await app.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
