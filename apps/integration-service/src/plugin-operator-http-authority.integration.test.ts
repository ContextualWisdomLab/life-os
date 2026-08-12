import { createHmac, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PluginCredentialApplication,
  type PluginCredentialBindingRecord,
  type PluginCredentialBindingStore,
  type PluginSecretStore,
} from './plugin-credential';
import {
  PluginInstallationApplication,
  type PluginInstallationRecord,
  type PluginInstallationStore,
} from './plugin-installation';
import { PluginOperatorApplication } from './plugin-operator-application';
import type { PluginOperatorReplayGuardPort } from './plugin-operator-replay';
import { IntegrationAppModule } from './main';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLATION_ID = '44444444-4444-4444-8444-444444444444';
const ISSUED_AT = '1786497600';
const NOW_SECONDS = Number(ISSUED_AT);
const CONTEXT_SECRET = randomBytes(32).toString('base64url');
const SECRET_VALUE = randomBytes(24).toString('base64url');
const EVIDENCE_IDS = [
  '77777777-7777-4777-8777-777777777771',
  '77777777-7777-4777-8777-777777777772',
  '77777777-7777-4777-8777-777777777773',
  '77777777-7777-4777-8777-777777777774',
  '77777777-7777-4777-8777-777777777775',
  '77777777-7777-4777-8777-777777777776',
  '77777777-7777-4777-8777-777777777777',
] as const;
const MANIFEST = Object.freeze({
  pluginId: 'com.example.calendar',
  displayName: 'Example Calendar',
  contractVersion: '1.0',
  subscriptions: ['lifeos.calendar.event.v1'],
});
const openApplications = new Set<INestApplication>();

class MemoryInstallationStore implements PluginInstallationStore {
  readonly records = new Map<string, PluginInstallationRecord>();

  async createIfAbsent(
    record: PluginInstallationRecord,
  ): Promise<PluginInstallationRecord> {
    const existing = this.records.get(record.installationId);
    if (existing) return existing;
    this.records.set(record.installationId, record);
    return record;
  }

  async findById(
    installationId: string,
    workspaceId: string,
    installedByUserId: string,
  ): Promise<PluginInstallationRecord | undefined> {
    const record = this.records.get(installationId);
    if (
      !record ||
      record.workspaceId !== workspaceId ||
      record.installedByUserId !== installedByUserId
    ) {
      return undefined;
    }
    return record;
  }

  async revokeActive(input: {
    readonly installationId: string;
    readonly workspaceId: string;
    readonly installedByUserId: string;
    readonly revokedAt: string;
  }): Promise<PluginInstallationRecord | undefined> {
    const record = await this.findById(
      input.installationId,
      input.workspaceId,
      input.installedByUserId,
    );
    if (!record) return undefined;
    if (record.status === 'revoked') return record;
    const revoked: PluginInstallationRecord = Object.freeze({
      ...record,
      status: 'revoked',
      revokedAt: input.revokedAt,
    });
    this.records.set(record.installationId, revoked);
    return revoked;
  }
}

class MemoryCredentialStore implements PluginCredentialBindingStore {
  readonly records = new Map<string, PluginCredentialBindingRecord>();

  async findById(
    credentialBindingId: string,
    workspaceId: string,
    installedByUserId: string,
  ): Promise<PluginCredentialBindingRecord | undefined> {
    const record = this.records.get(credentialBindingId);
    if (
      !record ||
      record.workspaceId !== workspaceId ||
      record.installedByUserId !== installedByUserId
    ) {
      return undefined;
    }
    return record;
  }

  async createIfAbsent(
    record: PluginCredentialBindingRecord,
  ): Promise<PluginCredentialBindingRecord> {
    const existing = this.records.get(record.credentialBindingId);
    if (existing) return existing;
    this.records.set(record.credentialBindingId, record);
    return record;
  }

  async revokeActive(input: {
    readonly credentialBindingId: string;
    readonly workspaceId: string;
    readonly installedByUserId: string;
    readonly revokedAt: string;
  }): Promise<PluginCredentialBindingRecord | undefined> {
    const record = await this.findById(
      input.credentialBindingId,
      input.workspaceId,
      input.installedByUserId,
    );
    if (!record) return undefined;
    if (record.status === 'revoked') return record;
    const revoked: PluginCredentialBindingRecord = Object.freeze({
      ...record,
      status: 'revoked',
      revokedAt: input.revokedAt,
    });
    this.records.set(record.credentialBindingId, revoked);
    return revoked;
  }
}

class MemorySecretStore implements PluginSecretStore {
  readonly references = new Set<string>();
  readonly puts: string[] = [];

  async putSecret(
    input: Parameters<PluginSecretStore['putSecret']>[0],
  ): Promise<string> {
    this.puts.push(input.credentialBindingId);
    const reference = `kms://plugin/${input.credentialBindingId}`;
    this.references.add(reference);
    return reference;
  }

  async deleteSecret(secretReference: string): Promise<void> {
    this.references.delete(secretReference);
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

function createOperator(): {
  readonly operator: PluginOperatorApplication;
  readonly installations: MemoryInstallationStore;
  readonly credentials: MemoryCredentialStore;
  readonly secrets: MemorySecretStore;
} {
  const installations = new MemoryInstallationStore();
  const installationApplication = new PluginInstallationApplication(
    installations,
    () => new Date('2026-08-12T02:40:00.000Z'),
  );
  const credentials = new MemoryCredentialStore();
  const secrets = new MemorySecretStore();
  const credentialApplication = new PluginCredentialApplication(
    installationApplication,
    credentials,
    secrets,
    () => new Date('2026-08-12T02:40:30.000Z'),
  );
  return Object.freeze({
    operator: new PluginOperatorApplication(
      installationApplication,
      credentialApplication,
      CONTEXT_SECRET,
      replayGuard(),
      () => NOW_SECONDS,
    ),
    installations,
    credentials,
    secrets,
  });
}

function signature(
  evidenceId: string,
  method: 'GET' | 'POST',
  path: string,
  issuedAt = ISSUED_AT,
): string {
  return createHmac('sha256', CONTEXT_SECRET)
    .update(
      `life-os.integration-operator-context.v1\n${WORKSPACE_ID}\n${USER_ID}\n${evidenceId}\n${issuedAt}\n${method}\n${path}`,
      'utf8',
    )
    .digest('base64url');
}

function headers(
  evidenceId: string,
  method: 'GET' | 'POST',
  path: string,
  issuedAt = ISSUED_AT,
): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-life-os-workspace-id': WORKSPACE_ID,
    'x-life-os-user-id': USER_ID,
    'x-life-os-context-evidence-id': evidenceId,
    'x-life-os-context-issued-at': issuedAt,
    'x-life-os-context-signature': signature(evidenceId, method, path, issuedAt),
  };
}

async function startApplication(
  configuredOperator?: PluginOperatorApplication,
): Promise<{
  readonly app: INestApplication;
  readonly origin: string;
}> {
  const module = configuredOperator
    ? IntegrationAppModule.withPluginOperator(configuredOperator)
    : IntegrationAppModule;
  const app = await NestFactory.create(module, { logger: false });
  openApplications.add(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  return Object.freeze({ app, origin: `http://127.0.0.1:${address.port}` });
}

/**
 * Sends a backend integration request. These tests authenticate exclusively with
 * one-time HMAC evidence and never use browser cookies, so browser CSRF semantics
 * are intentionally not part of this server-to-server transport contract.
 */
async function requestJson(
  origin: string,
  path: string,
  method: 'GET' | 'POST',
  requestHeaders: Record<string, string>,
  body?: unknown,
): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function problem(response: Response): Promise<{
  readonly status: number;
  readonly code: string;
}> {
  return (await response.json()) as {
    readonly status: number;
    readonly code: string;
  };
}

afterEach(async () => {
  await Promise.all(
    [...openApplications].map(async (app) => {
      openApplications.delete(app);
      await app.close();
    }),
  );
});

describe('plugin operator HTTP authority failures', () => {
  it('rejects replayed, stale, future, and malformed signed evidence before durable mutation', async () => {
    const runtime = createOperator();
    const { origin } = await startApplication(runtime.operator);
    const installPath = '/v1/plugins/installations';
    const installBody = {
      installationId: INSTALLATION_ID,
      manifest: MANIFEST,
      grantedCapabilities: ['lifeos.calendar.event.v1'],
    };
    const replayHeaders = headers(EVIDENCE_IDS[0], 'POST', installPath);

    const accepted = await requestJson(
      origin,
      installPath,
      'POST',
      replayHeaders,
      installBody,
    );
    expect(accepted.status).toBe(200);
    expect(runtime.installations.records.size).toBe(1);

    const replayed = await requestJson(
      origin,
      installPath,
      'POST',
      replayHeaders,
      installBody,
    );
    expect(replayed.status).toBe(401);
    expect(await problem(replayed)).toMatchObject({
      status: 401,
      code: 'invalid_plugin_operator_context',
    });
    expect(runtime.installations.records.size).toBe(1);

    const staleIssuedAt = String(NOW_SECONDS - 61);
    const stale = await requestJson(
      origin,
      installPath,
      'POST',
      headers(EVIDENCE_IDS[1], 'POST', installPath, staleIssuedAt),
      { ...installBody, installationId: '88888888-8888-4888-8888-888888888881' },
    );
    expect(stale.status).toBe(401);

    const futureIssuedAt = String(NOW_SECONDS + 6);
    const future = await requestJson(
      origin,
      installPath,
      'POST',
      headers(EVIDENCE_IDS[2], 'POST', installPath, futureIssuedAt),
      { ...installBody, installationId: '88888888-8888-4888-8888-888888888882' },
    );
    expect(future.status).toBe(401);

    const malformed = await requestJson(
      origin,
      installPath,
      'POST',
      headers(EVIDENCE_IDS[3], 'POST', installPath, 'not-a-time'),
      { ...installBody, installationId: '88888888-8888-4888-8888-888888888883' },
    );
    expect(malformed.status).toBe(401);
    expect(runtime.installations.records.size).toBe(1);
  });

  it('rejects malformed body identities without creating installation, credential, or secret state', async () => {
    const runtime = createOperator();
    const { origin } = await startApplication(runtime.operator);
    const installPath = '/v1/plugins/installations';

    const malformedInstallation = await requestJson(
      origin,
      installPath,
      'POST',
      headers(EVIDENCE_IDS[0], 'POST', installPath),
      {
        installationId: 'not-a-uuid',
        manifest: MANIFEST,
        grantedCapabilities: ['lifeos.calendar.event.v1'],
      },
    );
    expect(malformedInstallation.status).toBe(400);
    expect(await problem(malformedInstallation)).toMatchObject({
      status: 400,
      code: 'invalid_plugin_operator_request',
    });
    expect(runtime.installations.records.size).toBe(0);

    const validInstallation = await requestJson(
      origin,
      installPath,
      'POST',
      headers(EVIDENCE_IDS[1], 'POST', installPath),
      {
        installationId: INSTALLATION_ID,
        manifest: MANIFEST,
        grantedCapabilities: ['lifeos.calendar.event.v1'],
      },
    );
    expect(validInstallation.status).toBe(200);

    const bindPath = '/v1/plugins/credential-bindings';
    const malformedCredential = await requestJson(
      origin,
      bindPath,
      'POST',
      headers(EVIDENCE_IDS[2], 'POST', bindPath),
      {
        credentialBindingId: 'not-a-uuid',
        installationId: INSTALLATION_ID,
        credentialName: 'provider.access',
        secretValue: SECRET_VALUE,
      },
    );
    expect(malformedCredential.status).toBe(400);
    expect(await problem(malformedCredential)).toMatchObject({
      status: 400,
      code: 'invalid_plugin_operator_request',
    });
    expect(runtime.credentials.records.size).toBe(0);
    expect(runtime.secrets.puts).toEqual([]);
    expect(runtime.secrets.references.size).toBe(0);
  });

  it('treats malformed dynamic route identities as invalid signed authority rather than a body-validation error', async () => {
    const runtime = createOperator();
    const { origin } = await startApplication(runtime.operator);
    const malformedInstallationPath = '/v1/plugins/installations/not-a-uuid';
    const malformedRead = await requestJson(
      origin,
      malformedInstallationPath,
      'GET',
      headers(EVIDENCE_IDS[5], 'GET', malformedInstallationPath),
    );
    expect(malformedRead.status).toBe(401);
    expect(await problem(malformedRead)).toMatchObject({
      status: 401,
      code: 'invalid_plugin_operator_context',
    });

    const malformedCredentialPath =
      '/v1/plugins/credential-bindings/not-a-uuid/revoke';
    const malformedRevoke = await requestJson(
      origin,
      malformedCredentialPath,
      'POST',
      headers(EVIDENCE_IDS[6], 'POST', malformedCredentialPath),
    );
    expect(malformedRevoke.status).toBe(401);
    expect(await problem(malformedRevoke)).toMatchObject({
      status: 401,
      code: 'invalid_plugin_operator_context',
    });
    expect(runtime.installations.records.size).toBe(0);
    expect(runtime.credentials.records.size).toBe(0);
    expect(runtime.secrets.references.size).toBe(0);
  });
});
