import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PluginOperatorApplication,
  type PluginInstallationOperatorPort,
} from './plugin-operator-application';
import type { PluginOperatorReplayGuardPort } from './plugin-operator-replay';
import { IntegrationAppModule } from './main';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const DELIVERY_ID = '33333333-3333-4333-8333-333333333333';
const EVIDENCE_ID = '44444444-4444-4444-8444-444444444444';
const ISSUED_AT = '1788937200';
const CONTEXT_SECRET = 'status-http-context-secret-value-32-bytes-minimum';
const openApplications = new Set<INestApplication>();

const unusedInstallations: PluginInstallationOperatorPort = {
  async install() {
    throw new Error('installation capability must not be reached');
  },
  async getInstallation() {
    throw new Error('installation capability must not be reached');
  },
  async revoke() {
    throw new Error('installation capability must not be reached');
  },
};

const replayGuard: PluginOperatorReplayGuardPort = {
  async consume() {
    return true;
  },
};

function signature(path: string): string {
  return createHmac('sha256', CONTEXT_SECRET)
    .update(
      `life-os.integration-operator-context.v1\n${WORKSPACE_ID}\n${USER_ID}\n${EVIDENCE_ID}\n${ISSUED_AT}\nGET\n${path}`,
      'utf8',
    )
    .digest('base64url');
}

async function startApplication(): Promise<string> {
  const operator = new PluginOperatorApplication(
    unusedInstallations,
    undefined,
    CONTEXT_SECRET,
    replayGuard,
    () => Number(ISSUED_AT),
  );
  const app = await NestFactory.create(
    IntegrationAppModule.withPluginOperator(operator),
    { logger: false },
  );
  openApplications.add(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    [...openApplications].map(async (app) => {
      openApplications.delete(app);
      await app.close();
    }),
  );
});

describe('plugin delivery-attempt status HTTP composition', () => {
  it('exposes the signed route fail-closed when status persistence is not composed', async () => {
    const origin = await startApplication();
    const path = `/v1/plugins/delivery-attempts/${DELIVERY_ID}`;
    const response = await fetch(`${origin}${path}`, {
      method: 'GET',
      headers: {
        'x-life-os-workspace-id': WORKSPACE_ID,
        'x-life-os-user-id': USER_ID,
        'x-life-os-context-evidence-id': EVIDENCE_ID,
        'x-life-os-context-issued-at': ISSUED_AT,
        'x-life-os-context-signature': signature(path),
      },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      type: 'about:blank',
      title: 'Plugin delivery status capability is unavailable',
      status: 503,
      code: 'plugin_delivery_status_capability_unavailable',
    });
  });
});
