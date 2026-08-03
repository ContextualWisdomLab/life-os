import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { IntegrationAppModule } from './main';

const WORKSPACE_ID = '3b237d04-e84c-4ac4-933d-7f179865e1a0';
const OTHER_WORKSPACE_ID = '474c83ae-08af-4a63-957b-49eb2093a61d';
const EVENT_ID = '59b7f370-b733-435d-a72a-40878d6cffd1';
const SUBJECT_ID = 'e021b411-f75e-4490-97a4-f1f6ee811849';
const SYNTHETIC_CSRF_TOKEN = ['unit', 'csrf', 'value'].join(':');
const TEST_EMBEDDED_VALUE = ['must', 'not', 'be', 'embedded'].join(':');

async function postJson(
  port: number,
  path: string,
  body: unknown,
  workspaceId?: string,
): Promise<Response> {
  return await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': SYNTHETIC_CSRF_TOKEN,
      ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
    },
    body: JSON.stringify(body),
  });
}

function eventRequest(data: unknown = { title: 'Prepare launch', version: 2 }) {
  return {
    eventId: EVENT_ID,
    eventType: 'lifeos.planning.task-changed.v1',
    occurredAt: '2026-08-04T00:00:00.000Z',
    subject: `urn:life-os:task:${SUBJECT_ID}`,
    dataSchema: 'https://schemas.life-os.org/events/planning/task-changed/v1',
    data,
  };
}

describe('plugin contract HTTP boundary', () => {
  it('exposes strict discovery, manifest validation, and tenant-scoped event preparation only', async () => {
    const app = await NestFactory.create(IntegrationAppModule, { logger: false });
    await app.listen(0, '127.0.0.1');

    try {
      const address = app.getHttpServer().address() as AddressInfo;
      const discoveryResponse = await fetch(
        `http://127.0.0.1:${address.port}/v1/plugin-contract`,
      );
      expect(discoveryResponse.status).toBe(200);
      expect(await discoveryResponse.json()).toEqual({
        contractVersion: '1.0',
        cloudEventsSpecVersion: '1.0',
        eventContentType: 'application/cloudevents+json',
        maximumEventBytes: 65_536,
        signatureAlgorithm: 'hmac-sha256',
        deliveryTimestampSkewSeconds: 300,
        capabilities: ['manifest-validation', 'event-preparation'],
        deferredCapabilities: [
          'plugin-installation',
          'secret-storage',
          'outbound-delivery',
          'inbound-commands',
        ],
      });

      const manifestResponse = await postJson(
        address.port,
        '/v1/plugins/validate-manifest',
        {
          pluginId: 'com.example.lifeos.connector',
          displayName: 'Example Connector',
          contractVersion: '1.0',
          subscriptions: ['lifeos.planning.task-changed.v1'],
        },
      );
      expect(manifestResponse.status).toBe(200);
      expect(await manifestResponse.json()).toMatchObject({
        pluginId: 'com.example.lifeos.connector',
        contractVersion: '1.0',
      });

      const invalidManifest = await postJson(
        address.port,
        '/v1/plugins/validate-manifest',
        {
          pluginId: 'com.example.lifeos.connector',
          displayName: 'Example Connector',
          contractVersion: '1.0',
          subscriptions: ['lifeos.planning.task-changed.v1'],
          authorization: TEST_EMBEDDED_VALUE,
        },
      );
      expect(invalidManifest.status).toBe(400);
      expect(await invalidManifest.json()).toEqual({
        type: 'about:blank',
        title: 'Plugin contract is invalid',
        status: 400,
        code: 'invalid_plugin_contract',
      });

      const preparedResponse = await postJson(
        address.port,
        '/v1/events/prepare',
        eventRequest({ version: 2, title: 'Prepare launch' }),
        WORKSPACE_ID,
      );
      expect(preparedResponse.status).toBe(200);
      const prepared = (await preparedResponse.json()) as {
        event: { source: string; data: unknown };
        serializedEvent: string;
        byteLength: number;
      };
      expect(prepared.event.source).toBe(
        `urn:life-os:workspace:${WORKSPACE_ID}`,
      );
      expect(JSON.parse(prepared.serializedEvent)).toEqual(prepared.event);
      expect(Buffer.byteLength(prepared.serializedEvent, 'utf8')).toBe(
        prepared.byteLength,
      );
      expect(prepared.serializedEvent.indexOf('"title"')).toBeLessThan(
        prepared.serializedEvent.indexOf('"version"'),
      );

      const otherTenantResponse = await postJson(
        address.port,
        '/v1/events/prepare',
        eventRequest(),
        OTHER_WORKSPACE_ID,
      );
      expect(otherTenantResponse.status).toBe(200);
      expect(
        ((await otherTenantResponse.json()) as { event: { source: string } })
          .event.source,
      ).toBe(`urn:life-os:workspace:${OTHER_WORKSPACE_ID}`);

      const ownershipInjection = await postJson(
        address.port,
        '/v1/events/prepare',
        { ...eventRequest(), workspaceId: OTHER_WORKSPACE_ID },
        WORKSPACE_ID,
      );
      expect(ownershipInjection.status).toBe(400);

      const noWorkspace = await postJson(
        address.port,
        '/v1/events/prepare',
        eventRequest(),
      );
      expect(noWorkspace.status).toBe(400);

      const unsupportedDelivery = await postJson(
        address.port,
        '/v1/plugins/deliver',
        eventRequest(),
        WORKSPACE_ID,
      );
      expect(unsupportedDelivery.status).toBe(404);
      const unsupportedCommand = await postJson(
        address.port,
        '/v1/plugins/commands',
        { operation: 'delete-task' },
        WORKSPACE_ID,
      );
      expect(unsupportedCommand.status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
