import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import { IntegrationAppModule } from './main';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const EVIDENCE_ID = '33333333-3333-4333-8333-333333333333';
const INSTALLATION_ID = '44444444-4444-4444-8444-444444444444';
const openApplications = new Set<INestApplication>();

async function startApplication(): Promise<{
  readonly app: INestApplication;
  readonly origin: string;
}> {
  const app = await NestFactory.create(IntegrationAppModule, { logger: false });
  openApplications.add(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  return Object.freeze({ app, origin: `http://127.0.0.1:${address.port}` });
}

afterEach(async () => {
  await Promise.all(
    [...openApplications].map(async (app) => {
      openApplications.delete(app);
      await app.close();
    }),
  );
});

describe('plugin operator HTTP composition', () => {
  it('fails closed without an operator runtime and never reflects request material', async () => {
    const { origin } = await startApplication();
    const response = await fetch(`${origin}/v1/plugins/installations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-life-os-workspace-id': WORKSPACE_ID,
        'x-life-os-user-id': USER_ID,
        'x-life-os-context-evidence-id': EVIDENCE_ID,
        'x-life-os-context-issued-at': '1786291200',
        'x-life-os-context-signature': 'a'.repeat(43),
      },
      body: JSON.stringify({
        installationId: INSTALLATION_ID,
        manifest: {
          pluginId: 'com.example.calendar',
          displayName: 'Example Calendar',
          contractVersion: '1.0',
          subscriptions: ['lifeos.calendar.event.v1'],
        },
        grantedCapabilities: ['lifeos.calendar.event.v1'],
        attackerControlledMarker: 'must-not-be-reflected',
      }),
    });

    expect(response.status).toBe(503);
    const body = (await response.json()) as unknown;
    expect(body).toEqual({
      type: 'about:blank',
      title: 'Plugin operator runtime is unavailable',
      status: 503,
      code: 'plugin_operator_unavailable',
    });
    expect(JSON.stringify(body)).not.toContain('must-not-be-reflected');
  });
});
