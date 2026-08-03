import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './main';

const PRIMARY_WORKSPACE_ID = 'a83b7094-2432-4c1d-a721-9cd81e812635';
const SECONDARY_WORKSPACE_ID = 'f077da8a-d8a3-4d33-8761-188486d607dd';

function manifest(callbackUrl = 'https://hooks.example.com/life-os') {
  return {
    schema: 'life-os.plugin-manifest.v1',
    plugin_id: 'acme.delivery-assistant',
    version: '1.0.0',
    display_name: 'Acme Delivery Assistant',
    callback_url: callbackUrl,
    permissions: ['planning.read', 'planning.write'],
    webhook_event_types: ['planning.task.created'],
  };
}

describe('versioned plugin contract HTTP boundary', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('v1');
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a bounded contract and preserves tenant isolation', async () => {
    const registration = await fetch(`${baseUrl}/v1/plugins`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-workspace-id': PRIMARY_WORKSPACE_ID,
      },
      body: JSON.stringify(manifest()),
    });

    expect(registration.status).toBe(201);
    const registered = (await registration.json()) as {
      plugin_installation_id: string;
      workspace_id: string;
      manifest: { plugin_id: string };
      registered_at: string;
    };
    expect(registered.plugin_installation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(registered.workspace_id).toBe(PRIMARY_WORKSPACE_ID);
    expect(registered.manifest.plugin_id).toBe('acme.delivery-assistant');
    expect(new Date(registered.registered_at).toISOString()).toBe(
      registered.registered_at,
    );

    const primaryList = await fetch(`${baseUrl}/v1/plugins`, {
      headers: { 'x-workspace-id': PRIMARY_WORKSPACE_ID },
    });
    expect(primaryList.status).toBe(200);
    expect(await primaryList.json()).toHaveLength(1);

    const secondaryList = await fetch(`${baseUrl}/v1/plugins`, {
      headers: { 'x-workspace-id': SECONDARY_WORKSPACE_ID },
    });
    expect(secondaryList.status).toBe(200);
    expect(await secondaryList.json()).toEqual([]);
  });

  it('rejects duplicate identifiers and unsafe callback targets', async () => {
    const duplicate = await fetch(`${baseUrl}/v1/plugins`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-workspace-id': PRIMARY_WORKSPACE_ID,
      },
      body: JSON.stringify(manifest()),
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      error: 'plugin_already_registered',
    });

    const unsafe = await fetch(`${baseUrl}/v1/plugins`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-workspace-id': SECONDARY_WORKSPACE_ID,
      },
      body: JSON.stringify(
        manifest('https://169.254.169.254/latest/meta-data'),
      ),
    });
    expect(unsafe.status).toBe(400);
    expect(await unsafe.json()).toMatchObject({
      error: 'plugin_callback_url_not_public',
    });
  });

  it('fails closed when the workspace boundary is absent', async () => {
    const response = await fetch(`${baseUrl}/v1/plugins`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'workspace_id_invalid',
    });
  });
});
