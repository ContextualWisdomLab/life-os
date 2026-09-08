import { createHmac, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PluginOperatorApplication,
  type PluginDeliveryOriginOperatorPort,
  type PluginInstallationOperatorPort,
} from './plugin-operator-application';
import type {
  GrantPluginDeliveryOriginInput,
  PluginDeliveryOriginGrantRecord,
} from './plugin-delivery-origin-authority';
import type { PluginInstallationContext } from './plugin-installation';
import type { PluginOperatorReplayGuardPort } from './plugin-operator-replay';
import { IntegrationAppModule } from './main';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLATION_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';
const ISSUED_AT = '1786497600';
const NOW_SECONDS = Number(ISSUED_AT);
const CONTEXT_SECRET = randomBytes(32).toString('base64url');
const EVIDENCE_IDS = Object.freeze([
  '55555555-5555-4555-8555-555555555551',
  '55555555-5555-4555-8555-555555555552',
  '55555555-5555-4555-8555-555555555553',
  '55555555-5555-4555-8555-555555555554',
  '55555555-5555-4555-8555-555555555555',
] as const);
const openApplications = new Set<INestApplication>();

class InMemoryDeliveryOriginPort implements PluginDeliveryOriginOperatorPort {
  readonly records = new Map<string, PluginDeliveryOriginGrantRecord>();

  async grant(
    trustedContext: PluginInstallationContext,
    installationId: string,
    input: GrantPluginDeliveryOriginInput,
  ): Promise<PluginDeliveryOriginGrantRecord> {
    const record: PluginDeliveryOriginGrantRecord = Object.freeze({
      authorityVersion: 'life-os.plugin-delivery-origin.v1',
      grantId: input.grantId,
      installationId,
      workspaceId: trustedContext.workspaceId,
      grantedByUserId: trustedContext.actorUserId,
      origin: input.origin,
      status: 'active',
      grantedAt: '2026-08-12T02:40:00.000Z',
      revokedAt: null,
    });
    this.records.set(record.grantId, record);
    return record;
  }

  async getGrant(
    trustedContext: PluginInstallationContext,
    installationId: string,
    grantId: string,
  ): Promise<PluginDeliveryOriginGrantRecord | undefined> {
    const record = this.records.get(grantId);
    if (
      !record ||
      record.installationId !== installationId ||
      record.workspaceId !== trustedContext.workspaceId ||
      record.grantedByUserId !== trustedContext.actorUserId
    ) {
      return undefined;
    }
    return record;
  }

  async revoke(
    trustedContext: PluginInstallationContext,
    installationId: string,
    grantId: string,
  ): Promise<PluginDeliveryOriginGrantRecord> {
    const record = await this.getGrant(trustedContext, installationId, grantId);
    if (!record) throw new Error('missing delivery-origin grant');
    const revoked: PluginDeliveryOriginGrantRecord = Object.freeze({
      ...record,
      status: 'revoked',
      revokedAt: '2026-08-12T02:41:00.000Z',
    });
    this.records.set(grantId, revoked);
    return revoked;
  }
}

function replayGuard(): PluginOperatorReplayGuardPort {
  const consumed = new Set<string>();
  return {
    async consume(evidence) {
      if (consumed.has(evidence.evidenceId)) return false;
      consumed.add(evidence.evidenceId);
      return true;
    },
  };
}

function operator(
  deliveryOrigins?: PluginDeliveryOriginOperatorPort,
): PluginOperatorApplication {
  return new PluginOperatorApplication(
    {} as PluginInstallationOperatorPort,
    undefined,
    CONTEXT_SECRET,
    replayGuard(),
    () => NOW_SECONDS,
    deliveryOrigins,
  );
}

function signature(
  evidenceId: string,
  method: 'GET' | 'POST',
  path: string,
): string {
  return createHmac('sha256', CONTEXT_SECRET)
    .update(
      `life-os.integration-operator-context.v1\n${WORKSPACE_ID}\n${USER_ID}\n${evidenceId}\n${ISSUED_AT}\n${method}\n${path}`,
      'utf8',
    )
    .digest('base64url');
}

function headers(
  evidenceId: string,
  method: 'GET' | 'POST',
  path: string,
): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-life-os-workspace-id': WORKSPACE_ID,
    'x-life-os-user-id': USER_ID,
    'x-life-os-context-evidence-id': evidenceId,
    'x-life-os-context-issued-at': ISSUED_AT,
    'x-life-os-context-signature': signature(evidenceId, method, path),
  };
}

async function startApplication(
  configuredOperator: PluginOperatorApplication,
): Promise<{ readonly origin: string }> {
  const app = await NestFactory.create(
    IntegrationAppModule.withPluginOperator(configuredOperator),
    { logger: false },
  );
  openApplications.add(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  return Object.freeze({ origin: `http://127.0.0.1:${address.port}` });
}

afterEach(async () => {
  await Promise.all(
    [...openApplications].map(async (app) => {
      openApplications.delete(app);
      await app.close();
    }),
  );
});

describe('plugin delivery-origin HTTP lifecycle', () => {
  it('serves signed grant, read, and revoke through the exact installation-scoped routes', async () => {
    const { origin } = await startApplication(
      operator(new InMemoryDeliveryOriginPort()),
    );
    const collectionPath = `/v1/plugins/installations/${INSTALLATION_ID}/delivery-origins`;
    const granted = await fetch(`${origin}${collectionPath}`, {
      method: 'POST',
      headers: headers(EVIDENCE_IDS[0], 'POST', collectionPath),
      body: JSON.stringify({
        grantId: GRANT_ID,
        origin: 'https://calendar.example.com',
        workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        grantedByUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    });
    expect(granted.status).toBe(200);
    expect(await granted.json()).toMatchObject({
      grantId: GRANT_ID,
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      grantedByUserId: USER_ID,
      origin: 'https://calendar.example.com',
      status: 'active',
    });

    const itemPath = `${collectionPath}/${GRANT_ID}`;
    const read = await fetch(`${origin}${itemPath}`, {
      method: 'GET',
      headers: headers(EVIDENCE_IDS[1], 'GET', itemPath),
    });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      grantId: GRANT_ID,
      status: 'active',
    });

    const revokePath = `${itemPath}/revoke`;
    const revoked = await fetch(`${origin}${revokePath}`, {
      method: 'POST',
      headers: headers(EVIDENCE_IDS[2], 'POST', revokePath),
    });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({
      grantId: GRANT_ID,
      status: 'revoked',
    });
  });

  it('fails forged and uncomposed delivery-origin authority without reflecting request material', async () => {
    const collectionPath = `/v1/plugins/installations/${INSTALLATION_ID}/delivery-origins`;
    const configured = await startApplication(
      operator(new InMemoryDeliveryOriginPort()),
    );
    const forged = await fetch(`${configured.origin}${collectionPath}`, {
      method: 'POST',
      headers: {
        ...headers(EVIDENCE_IDS[3], 'POST', collectionPath),
        'x-life-os-context-signature': 'a'.repeat(43),
      },
      body: JSON.stringify({
        grantId: GRANT_ID,
        origin: 'https://must-not-be-reflected.example',
      }),
    });
    expect(forged.status).toBe(401);
    const forgedBody = await forged.json();
    expect(forgedBody).toMatchObject({
      code: 'invalid_plugin_operator_context',
    });
    expect(JSON.stringify(forgedBody)).not.toContain('must-not-be-reflected');

    const unavailable = await startApplication(operator());
    const response = await fetch(`${unavailable.origin}${collectionPath}`, {
      method: 'POST',
      headers: headers(EVIDENCE_IDS[0], 'POST', collectionPath),
      body: JSON.stringify({
        grantId: GRANT_ID,
        origin: 'https://calendar.example.com',
      }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'plugin_delivery_origin_capability_unavailable',
    });
  });

  it('rejects a percent-encoded route alias authenticated only for the canonical path', async () => {
    const deliveryOrigins = new InMemoryDeliveryOriginPort();
    const { origin } = await startApplication(operator(deliveryOrigins));
    const canonicalPath = `/v1/plugins/installations/${INSTALLATION_ID}/delivery-origins`;
    const encodedInstallationId = `%33${INSTALLATION_ID.slice(1)}`;
    const aliasedPath = `/v1/plugins/installations/${encodedInstallationId}/delivery-origins`;

    const response = await fetch(`${origin}${aliasedPath}`, {
      method: 'POST',
      headers: headers(EVIDENCE_IDS[4], 'POST', canonicalPath),
      body: JSON.stringify({
        grantId: GRANT_ID,
        origin: 'https://calendar.example.com',
      }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: 'invalid_plugin_operator_context',
    });
    expect(deliveryOrigins.records.size).toBe(0);
  });
});
