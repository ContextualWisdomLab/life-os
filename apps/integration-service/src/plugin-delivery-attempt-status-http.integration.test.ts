import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginDeliveryAttemptStatusEvidence } from './plugin-delivery-attempt-status';
import {
  PluginOperatorApplication,
  type PluginDeliveryAttemptStatusOperatorPort,
  type PluginInstallationOperatorPort,
} from './plugin-operator-application';
import type { PluginOperatorReplayGuardPort } from './plugin-operator-replay';
import { IntegrationAppModule } from './main';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const DELIVERY_ID = '33333333-3333-4333-8333-333333333333';
const EVIDENCE_ID = '44444444-4444-4444-8444-444444444444';
const ALIAS_EVIDENCE_ID = '55555555-5555-4555-8555-555555555555';
const GRANT_ID = '66666666-6666-4666-8666-666666666666';
const INSTALLATION_ID = '77777777-7777-4777-8777-777777777777';
const ISSUED_AT = '1788937200';
const CHECKED_AT = '2026-09-09T07:00:00.000Z';
const CONTEXT_SECRET = 'status-http-context-secret-value-32-bytes-minimum';
const openApplications = new Set<INestApplication>();

const STATUS_EVIDENCE: PluginDeliveryAttemptStatusEvidence = Object.freeze({
  authorityVersion: 'life-os.plugin-delivery-attempt-status.v1',
  deliveryId: DELIVERY_ID,
  grantId: GRANT_ID,
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  requestedByUserId: USER_ID,
  deliveryStatus: 'pending',
  attemptCount: 0,
  maxAttempts: 3,
  requestedAt: '2026-09-09T06:59:00.000Z',
  updatedAt: '2026-09-09T06:59:00.000Z',
  nextAttemptAt: '2026-09-09T07:01:00.000Z',
  terminalAt: null,
  lastOutcomeCode: null,
  controlSequence: 0,
  claimState: 'unclaimed',
  checkedAt: CHECKED_AT,
});

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

function signature(path: string, evidenceId = EVIDENCE_ID): string {
  return createHmac('sha256', CONTEXT_SECRET)
    .update(
      `life-os.integration-operator-context.v1\n${WORKSPACE_ID}\n${USER_ID}\n${evidenceId}\n${ISSUED_AT}\nGET\n${path}`,
      'utf8',
    )
    .digest('base64url');
}

function headers(
  path: string,
  evidenceId = EVIDENCE_ID,
): Record<string, string> {
  return {
    'x-life-os-workspace-id': WORKSPACE_ID,
    'x-life-os-user-id': USER_ID,
    'x-life-os-context-evidence-id': evidenceId,
    'x-life-os-context-issued-at': ISSUED_AT,
    'x-life-os-context-signature': signature(path, evidenceId),
  };
}

async function startApplication(
  deliveryStatus?: PluginDeliveryAttemptStatusOperatorPort,
): Promise<string> {
  const operator = new PluginOperatorApplication(
    unusedInstallations,
    undefined,
    CONTEXT_SECRET,
    replayGuard,
    () => Number(ISSUED_AT),
    deliveryStatus,
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
      headers: headers(path),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      type: 'about:blank',
      title: 'Plugin delivery status capability is unavailable',
      status: 503,
      code: 'plugin_delivery_status_capability_unavailable',
    });
  });

  it('returns only the credential-free scoped status evidence after signed authority', async () => {
    const read = vi.fn(async () => STATUS_EVIDENCE);
    const origin = await startApplication({ read });
    const path = `/v1/plugins/delivery-attempts/${DELIVERY_ID}`;
    const response = await fetch(`${origin}${path}`, {
      method: 'GET',
      headers: headers(path),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(STATUS_EVIDENCE);
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
      DELIVERY_ID,
    );
  });

  it('rejects a percent-encoded raw-path alias before decoded route authority', async () => {
    const read = vi.fn(async () => STATUS_EVIDENCE);
    const origin = await startApplication({ read });
    const canonicalPath = `/v1/plugins/delivery-attempts/${DELIVERY_ID}`;
    const rawAliasPath = `/v1/plugins/delivery-attempts/%33${DELIVERY_ID.slice(1)}`;
    const response = await fetch(`${origin}${rawAliasPath}`, {
      method: 'GET',
      headers: headers(canonicalPath, ALIAS_EVIDENCE_ID),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      type: 'about:blank',
      title: 'Plugin operator context is invalid',
      status: 401,
      code: 'invalid_plugin_operator_context',
    });
    expect(read).not.toHaveBeenCalled();
  });
});
