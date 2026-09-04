import { NestFactory } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { PluginOperatorApplication } from './plugin-operator-application';
import type { PluginVaultHostedRuntime } from './plugin-vault-hosted-runtime';
import { IntegrationAppModule } from './main';

describe('IntegrationAppModule hosted Plugin runtime', () => {
  it('registers the composed operator and closes its owned runtime exactly once on application shutdown', async () => {
    const close = vi.fn(async () => undefined);
    const runtime: PluginVaultHostedRuntime = {
      operator: {} as PluginOperatorApplication,
      close,
    };

    const app = await NestFactory.createApplicationContext(
      IntegrationAppModule.withPluginOperatorRuntime(runtime),
      { logger: false },
    );

    await app.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
