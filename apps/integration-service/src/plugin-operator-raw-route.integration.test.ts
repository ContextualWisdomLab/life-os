import { createHmac, randomBytes } from 'node:crypto';
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
const INSTALLATION_ID = '44444444-4444-4444-8444-444444444444';
const EVIDENCE_ID = '33333333-3333-4333-8333-333333333340';
const ISSUED_AT = '1786497600';
const CONTEXT_SECRET = randomBytes(32).toString('base64url');
const openApplications = new Set<INestApplication>();

function replayGuard(): PluginOperatorReplayGuardPort {
  return {
    async consume() {
      return true;
    },
  };
}

function signature(path: string): string {
  return createHmac('sha256', CONTEXT_SECRET)
    .update(
      `life-os.integration-operator-context.v1\n${WORKSPACE_ID}\n${USER_ID}\n${EVIDENCE_ID}\n${ISSUED_AT}\nGET\n${path}`,
      'utf8',
    )
    .digest('base64url');
}

async function startApplication(
  installations: PluginInstallationOperatorPort,
): Promise<{ readonly origin: string }> {
  const operator = new PluginOperatorApplication(
    installations,
    undefined,
    CONTEXT_SECRET,
    replayGuard(),
    () => Number(ISSUED_AT),
  );
  const app = await NestFactory.create(
    IntegrationAppModule.withPluginOperator(operator),
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

describe('plugin operator raw-route authority', () => {
  it('rejects an encoded installation alias before decoded parameters reach durable authority', async () => {
    let reads = 0;
    const installations: PluginInstallationOperatorPort = {
      async install() {
        throw new Error('install must not run');
      },
      async getInstallation() {
        reads += 1;
        return undefined;
      },
      async revoke() {
        throw new Error('revoke must not run');
      },
    };
    const { origin } = await startApplication(installations);
    const canonicalPath = `/v1/plugins/installations/${INSTALLATION_ID}`;
    const encodedInstallationId = `%34${INSTALLATION_ID.slice(1)}`;
    const aliasedPath = `/v1/plugins/installations/${encodedInstallationId}`;

    const response = await fetch(`${origin}${aliasedPath}`, {
      method: 'GET',
      headers: {
        'x-life-os-workspace-id': WORKSPACE_ID,
        'x-life-os-user-id': USER_ID,
        'x-life-os-context-evidence-id': EVIDENCE_ID,
        'x-life-os-context-issued-at': ISSUED_AT,
        'x-life-os-context-signature': signature(canonicalPath),
      },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: 'invalid_plugin_operator_context',
    });
    expect(reads).toBe(0);
  });
});
