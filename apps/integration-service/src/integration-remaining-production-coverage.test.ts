import type { AddressInfo } from 'node:net';
import { HttpException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PutPluginSecretInput } from './plugin-credential';
import type { PluginOperatorApplication } from './plugin-operator-application';
import {
  IntegrationAppModule,
  IntegrationController,
  PluginOperatorHttpController,
} from './main';
import {
  PluginVaultSecretStore,
  PluginVaultSecretStoreError,
  type PluginVaultHttpClient,
  type PluginVaultHttpResponse,
} from './plugin-vault-secret-store';

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const BINDING_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const TOKEN = 'test-vault-token-not-a-real-credential';
const REFERENCE = `lifeos-plugin-vault://${BINDING_ID}`;
const encoder = new TextEncoder();
const openApplications = new Set<Awaited<ReturnType<typeof NestFactory.create>>>();

const SECRET_INPUT: PutPluginSecretInput = Object.freeze({
  credentialBindingId: BINDING_ID,
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  credentialName: 'provider.access',
  secretValue: 'buyer secret value',
});

function vaultRead(): string {
  return JSON.stringify({
    data: {
      data: {
        schemaVersion: 1,
        ...SECRET_INPUT,
      },
    },
  });
}

function vaultResponse(
  status: number,
  body: ReadableStream<Uint8Array> | null = null,
): PluginVaultHttpResponse {
  return { status, headers: { get: () => null }, body };
}

function vaultStore(http: PluginVaultHttpClient): PluginVaultSecretStore {
  return new PluginVaultSecretStore(
    'https://vault.example.test',
    TOKEN,
    'secret',
    http,
  );
}

async function expectVaultUnavailable(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toBeInstanceOf(PluginVaultSecretStoreError);
}

function streamWithReader(reader: object): ReadableStream<Uint8Array> {
  return {
    getReader: () => reader,
  } as unknown as ReadableStream<Uint8Array>;
}

function problemCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const body = error.getResponse();
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  return (body as { readonly code?: string }).code;
}

afterEach(async () => {
  await Promise.all(
    [...openApplications].map(async (app) => {
      openApplications.delete(app);
      await app.close();
    }),
  );
  vi.unstubAllGlobals();
});

describe('Integration remaining production coverage', () => {
  it('covers health, hostile manifest propagation, invalid body selection, and revoke dependency failure', async () => {
    const baseController = new IntegrationController();
    expect(baseController.health()).toEqual({
      status: 'ok',
      service: 'integration-service',
    });

    const hostile = Proxy.revocable({}, {});
    hostile.revoke();
    expect(() => baseController.validateManifest(hostile.proxy)).toThrow(TypeError);

    const install = vi.fn();
    const revokeInstallation = vi.fn(async () => {
      throw new Error('dependency detail must stay private');
    });
    const controller = new PluginOperatorHttpController({
      install,
      revokeInstallation,
    } as unknown as PluginOperatorApplication);

    await expect(
      controller.install(undefined, undefined, undefined, undefined, undefined, []),
    ).rejects.toSatisfy(
      (error: unknown) => problemCode(error) === 'invalid_plugin_operator_request',
    );
    expect(install).not.toHaveBeenCalled();

    await expect(
      controller.revokeInstallation(
        INSTALLATION_ID,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toSatisfy(
      (error: unknown) => problemCode(error) === 'plugin_operator_failure',
    );
    expect(revokeInstallation).toHaveBeenCalledTimes(1);
  });

  it('covers raw-route URL fallbacks without accepting an absent route', async () => {
    const path = `/v1/plugins/delivery-attempts/${DELIVERY_ID}`;
    const getDeliveryAttemptStatus = vi.fn(async () => ({
      authorityVersion: 'life-os.plugin-delivery-attempt-status.v1',
      deliveryId: DELIVERY_ID,
    }));
    const controller = new PluginOperatorHttpController({
      getDeliveryAttemptStatus,
    } as unknown as PluginOperatorApplication);

    await expect(
      controller.getDeliveryAttemptStatus(
        DELIVERY_ID,
        { method: 'GET', url: path },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    ).resolves.toMatchObject({ deliveryId: DELIVERY_ID });

    await expect(
      controller.getDeliveryAttemptStatus(
        DELIVERY_ID,
        { method: 'GET' },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toSatisfy(
      (error: unknown) => problemCode(error) === 'invalid_plugin_operator_context',
    );
  });

  it('normalizes malformed JSON across every operator route family and preserves the non-operator fallback', async () => {
    const app = await NestFactory.create(
      IntegrationAppModule.withPluginOperator({} as PluginOperatorApplication),
      { logger: false },
    );
    openApplications.add(app);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;

    const operatorPaths = [
      '/v1/plugins/installations',
      `/v1/plugins/installations/${INSTALLATION_ID}/revoke`,
      '/v1/plugins/credential-bindings',
      `/v1/plugins/credential-bindings/${BINDING_ID}/revoke`,
      `/v1/plugins/delivery-attempts/${DELIVERY_ID}`,
    ];
    for (const path of operatorPaths) {
      const response = await fetch(`${origin}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        status: 400,
        code: 'invalid_plugin_operator_request',
      });
    }

    const ordinary = await fetch(`${origin}/v1/events/prepare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(ordinary.status).toBe(400);
    const ordinaryBody = (await ordinary.json()) as { readonly code?: string };
    expect(ordinaryBody.code).not.toBe('invalid_plugin_operator_request');
  });

  it('covers no-body default fetch and reconciliation transport failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(vaultResponse(204));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new PluginVaultSecretStore('https://vault.example.test', TOKEN).deleteSecret(
        REFERENCE,
      ),
    ).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body');
    vi.unstubAllGlobals();

    const unavailableHttp = vi
      .fn<PluginVaultHttpClient>()
      .mockRejectedValue(new Error('provider unavailable'));
    await expectVaultUnavailable(vaultStore(unavailableHttp).putSecret(SECRET_INPUT));
    expect(unavailableHttp).toHaveBeenCalledTimes(2);
  });

  it('fails closed on malformed stream chunks and invalid UTF-8 while cleaning reader state', async () => {
    const malformedReader = {
      read: vi.fn(async () => ({ done: false, value: 'not-bytes' })),
      cancel: vi.fn(async () => undefined),
      releaseLock: vi.fn(),
    };
    const malformedHttp = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(vaultResponse(400))
      .mockResolvedValueOnce(vaultResponse(200, streamWithReader(malformedReader)));
    await expectVaultUnavailable(vaultStore(malformedHttp).putSecret(SECRET_INPUT));
    expect(malformedReader.cancel).toHaveBeenCalledTimes(1);

    let readCount = 0;
    const invalidUtf8Reader = {
      read: vi.fn(async () => {
        readCount += 1;
        return readCount === 1
          ? { done: false, value: Uint8Array.of(0xff) }
          : { done: true, value: undefined };
      }),
      cancel: vi.fn(async () => undefined),
      releaseLock: vi.fn(),
    };
    const invalidUtf8Http = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(vaultResponse(400))
      .mockResolvedValueOnce(vaultResponse(200, streamWithReader(invalidUtf8Reader)));
    await expectVaultUnavailable(vaultStore(invalidUtf8Http).putSecret(SECRET_INPUT));
  });

  it('accepts exact replay evidence even when releaseLock reports an already-released reader', async () => {
    const bytes = encoder.encode(vaultRead());
    let readCount = 0;
    const reader = {
      read: vi.fn(async () => {
        readCount += 1;
        return readCount === 1
          ? { done: false, value: bytes }
          : { done: true, value: undefined };
      }),
      cancel: vi.fn(async () => undefined),
      releaseLock: vi.fn(() => {
        throw new TypeError('already released');
      }),
    };
    const http = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(vaultResponse(409))
      .mockResolvedValueOnce(vaultResponse(200, streamWithReader(reader)));

    await expect(vaultStore(http).putSecret(SECRET_INPUT)).resolves.toBe(REFERENCE);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });
});
