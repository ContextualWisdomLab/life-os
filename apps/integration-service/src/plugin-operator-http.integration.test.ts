import { createHmac, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PluginOperatorApplication,
  type PluginCredentialOperatorPort,
  type PluginInstallationOperatorPort,
} from './plugin-operator-application';
import { IntegrationOperatorContextError } from './plugin-operator-context';
import type { PluginOperatorReplayGuardPort } from './plugin-operator-replay';
import {
  PluginCredentialError,
  type PluginCredentialBindingView,
} from './plugin-credential';
import {
  PluginInstallationError,
  type PluginInstallationContext,
  type PluginInstallationRecord,
} from './plugin-installation';
import { IntegrationAppModule } from './main';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLATION_ID = '44444444-4444-4444-8444-444444444444';
const CREDENTIAL_BINDING_ID = '55555555-5555-4555-8555-555555555555';
const MISSING_INSTALLATION_ID = '66666666-6666-4666-8666-666666666666';
const EVIDENCE_IDS = Object.freeze([
  '33333333-3333-4333-8333-333333333331',
  '33333333-3333-4333-8333-333333333332',
  '33333333-3333-4333-8333-333333333333',
  '33333333-3333-4333-8333-333333333334',
  '33333333-3333-4333-8333-333333333335',
  '33333333-3333-4333-8333-333333333336',
  '33333333-3333-4333-8333-333333333337',
  '33333333-3333-4333-8333-333333333338',
  '33333333-3333-4333-8333-333333333339',
] as const);
const ISSUED_AT = '1786497600';
const NOW_SECONDS = Number(ISSUED_AT);
const CONTEXT_SECRET = randomBytes(32).toString('base64url');
const CREDENTIAL_VALUE = randomBytes(24).toString('base64url');
const openApplications = new Set<INestApplication>();

const MANIFEST = Object.freeze({
  pluginId: 'com.example.calendar',
  displayName: 'Example Calendar',
  contractVersion: '1.0',
  subscriptions: ['lifeos.calendar.event.v1'],
});

class InMemoryInstallationPort implements PluginInstallationOperatorPort {
  readonly records = new Map<string, PluginInstallationRecord>();

  async install(
    input: Parameters<PluginInstallationOperatorPort['install']>[0],
  ): Promise<PluginInstallationRecord> {
    const record: PluginInstallationRecord = Object.freeze({
      installationId: input.installationId,
      workspaceId: input.trustedContext.workspaceId,
      installedByUserId: input.trustedContext.actorUserId,
      pluginId: input.manifest.pluginId,
      pluginContractVersion: input.manifest.contractVersion,
      manifestSha256: 'a'.repeat(64),
      grantedCapabilities: Object.freeze([...input.grantedCapabilities]),
      status: 'active',
      installedAt: '2026-08-12T02:40:00.000Z',
      revokedAt: null,
    });
    this.records.set(record.installationId, record);
    return record;
  }

  async getInstallation(
    trustedContext: PluginInstallationContext,
    installationId: string,
  ): Promise<PluginInstallationRecord | undefined> {
    const record = this.records.get(installationId);
    if (
      !record ||
      record.workspaceId !== trustedContext.workspaceId ||
      record.installedByUserId !== trustedContext.actorUserId
    ) {
      return undefined;
    }
    return record;
  }

  async revoke(
    trustedContext: PluginInstallationContext,
    installationId: string,
  ): Promise<PluginInstallationRecord> {
    const record = await this.getInstallation(trustedContext, installationId);
    if (!record) throw new PluginInstallationError();
    const revoked: PluginInstallationRecord = Object.freeze({
      ...record,
      status: 'revoked',
      revokedAt: '2026-08-12T02:41:00.000Z',
    });
    this.records.set(installationId, revoked);
    return revoked;
  }
}

class InMemoryCredentialPort implements PluginCredentialOperatorPort {
  readonly records = new Map<string, PluginCredentialBindingView>();

  async bind(
    input: Parameters<PluginCredentialOperatorPort['bind']>[0],
  ): Promise<PluginCredentialBindingView> {
    const view: PluginCredentialBindingView = Object.freeze({
      credentialBindingId: input.credentialBindingId,
      installationId: input.installationId,
      workspaceId: input.trustedContext.workspaceId,
      installedByUserId: input.trustedContext.actorUserId,
      credentialName: input.credentialName,
      status: 'active',
      boundAt: '2026-08-12T02:40:30.000Z',
      revokedAt: null,
    });
    this.records.set(view.credentialBindingId, view);
    return view;
  }

  async revoke(
    trustedContext: PluginInstallationContext,
    credentialBindingId: string,
  ): Promise<PluginCredentialBindingView> {
    const record = this.records.get(credentialBindingId);
    if (
      !record ||
      record.workspaceId !== trustedContext.workspaceId ||
      record.installedByUserId !== trustedContext.actorUserId
    ) {
      throw new PluginCredentialError();
    }
    const revoked: PluginCredentialBindingView = Object.freeze({
      ...record,
      status: 'revoked',
      revokedAt: '2026-08-12T02:41:30.000Z',
    });
    this.records.set(credentialBindingId, revoked);
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
  installations: PluginInstallationOperatorPort = new InMemoryInstallationPort(),
  credentials: PluginCredentialOperatorPort | undefined = new InMemoryCredentialPort(),
  guard: PluginOperatorReplayGuardPort | undefined = replayGuard(),
): PluginOperatorApplication {
  return new PluginOperatorApplication(
    installations,
    credentials,
    CONTEXT_SECRET,
    guard,
    () => NOW_SECONDS,
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

async function problemBody(response: Response): Promise<{
  readonly status: number;
  readonly code: string;
}> {
  return (await response.json()) as { readonly status: number; readonly code: string };
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
        'x-life-os-context-evidence-id': EVIDENCE_IDS[0],
        'x-life-os-context-issued-at': ISSUED_AT,
        'x-life-os-context-signature': 'a'.repeat(43),
      },
      body: JSON.stringify({
        installationId: INSTALLATION_ID,
        manifest: MANIFEST,
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

  it('serves the configured installation and credential lifecycle without exposing secret material', async () => {
    const installations = new InMemoryInstallationPort();
    const credentials = new InMemoryCredentialPort();
    const { origin } = await startApplication(operator(installations, credentials));

    const installPath = '/v1/plugins/installations';
    const installed = await fetch(`${origin}${installPath}`, {
      method: 'POST',
      headers: headers(EVIDENCE_IDS[0], 'POST', installPath),
      body: JSON.stringify({
        installationId: INSTALLATION_ID,
        manifest: MANIFEST,
        grantedCapabilities: ['lifeos.calendar.event.v1'],
        workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        installedByUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    });
    expect(installed.status).toBe(200);
    expect(await installed.json()).toMatchObject({
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      installedByUserId: USER_ID,
      status: 'active',
    });

    const bindPath = '/v1/plugins/credential-bindings';
    const bound = await fetch(`${origin}${bindPath}`, {
      method: 'POST',
      headers: headers(EVIDENCE_IDS[1], 'POST', bindPath),
      body: JSON.stringify({
        credentialBindingId: CREDENTIAL_BINDING_ID,
        installationId: INSTALLATION_ID,
        credentialName: 'provider.access',
        secretValue: CREDENTIAL_VALUE,
        workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    });
    expect(bound.status).toBe(200);
    const boundBody = (await bound.json()) as unknown;
    expect(boundBody).toMatchObject({
      credentialBindingId: CREDENTIAL_BINDING_ID,
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      installedByUserId: USER_ID,
      status: 'active',
    });
    expect(JSON.stringify(boundBody)).not.toContain(CREDENTIAL_VALUE);
    expect(JSON.stringify(boundBody)).not.toContain('secretReference');

    const getPath = `/v1/plugins/installations/${INSTALLATION_ID}`;
    const read = await fetch(`${origin}${getPath}`, {
      method: 'GET',
      headers: headers(EVIDENCE_IDS[2], 'GET', getPath),
    });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      installedByUserId: USER_ID,
      status: 'active',
    });

    const credentialRevokePath =
      `/v1/plugins/credential-bindings/${CREDENTIAL_BINDING_ID}/revoke`;
    const credentialRevoked = await fetch(`${origin}${credentialRevokePath}`, {
      method: 'POST',
      headers: headers(EVIDENCE_IDS[3], 'POST', credentialRevokePath),
    });
    expect(credentialRevoked.status).toBe(200);
    expect(await credentialRevoked.json()).toMatchObject({
      credentialBindingId: CREDENTIAL_BINDING_ID,
      status: 'revoked',
    });

    const installationRevokePath =
      `/v1/plugins/installations/${INSTALLATION_ID}/revoke`;
    const installationRevoked = await fetch(
      `${origin}${installationRevokePath}`,
      {
        method: 'POST',
        headers: headers(EVIDENCE_IDS[4], 'POST', installationRevokePath),
      },
    );
    expect(installationRevoked.status).toBe(200);
    expect(await installationRevoked.json()).toMatchObject({
      installationId: INSTALLATION_ID,
      status: 'revoked',
    });
  });

  it('maps forged, verifier-unavailable, and missing-record evidence to bounded problems', async () => {
    const { origin } = await startApplication(operator());
    const installPath = '/v1/plugins/installations';
    const forged = await fetch(`${origin}${installPath}`, {
      method: 'POST',
      headers: {
        ...headers(EVIDENCE_IDS[5], 'POST', installPath),
        'x-life-os-context-signature': 'a'.repeat(43),
      },
      body: JSON.stringify({
        installationId: INSTALLATION_ID,
        manifest: MANIFEST,
        grantedCapabilities: ['lifeos.calendar.event.v1'],
      }),
    });
    expect(forged.status).toBe(401);
    expect(await problemBody(forged)).toMatchObject({
      status: 401,
      code: 'invalid_plugin_operator_context',
    });

    const unavailableApp = await startApplication(
      operator(new InMemoryInstallationPort(), new InMemoryCredentialPort(), undefined),
    );
    const unavailable = await fetch(`${unavailableApp.origin}${installPath}`, {
      method: 'POST',
      headers: headers(EVIDENCE_IDS[6], 'POST', installPath),
      body: JSON.stringify({
        installationId: INSTALLATION_ID,
        manifest: MANIFEST,
        grantedCapabilities: ['lifeos.calendar.event.v1'],
      }),
    });
    expect(unavailable.status).toBe(503);
    expect(await problemBody(unavailable)).toMatchObject({
      status: 503,
      code: 'plugin_operator_context_unavailable',
    });

    const missingPath = `/v1/plugins/installations/${MISSING_INSTALLATION_ID}`;
    const missing = await fetch(`${origin}${missingPath}`, {
      method: 'GET',
      headers: headers(EVIDENCE_IDS[7], 'GET', missingPath),
    });
    expect(missing.status).toBe(404);
    expect(await problemBody(missing)).toMatchObject({
      status: 404,
      code: 'plugin_operator_not_found',
    });
  });

  it('maps credential capability, domain validation, invalid bodies, and unknown failures without reflection', async () => {
    const noCredentials = await startApplication(
      operator(new InMemoryInstallationPort(), undefined),
    );
    const bindPath = '/v1/plugins/credential-bindings';
    const unavailableCredential = await fetch(`${noCredentials.origin}${bindPath}`, {
      method: 'POST',
      headers: headers(EVIDENCE_IDS[0], 'POST', bindPath),
      body: JSON.stringify({
        credentialBindingId: CREDENTIAL_BINDING_ID,
        installationId: INSTALLATION_ID,
        credentialName: 'provider.access',
        secretValue: CREDENTIAL_VALUE,
      }),
    });
    expect(unavailableCredential.status).toBe(503);
    expect(await problemBody(unavailableCredential)).toMatchObject({
      status: 503,
      code: 'plugin_credential_capability_unavailable',
    });

    const invalidInstallationPort: PluginInstallationOperatorPort = {
      async install() {
        throw new PluginInstallationError();
      },
      async getInstallation() {
        return undefined;
      },
      async revoke() {
        throw new PluginInstallationError();
      },
    };
    const invalidInstallation = await startApplication(
      operator(invalidInstallationPort),
    );
    const domainInvalid = await fetch(`${invalidInstallation.origin}/v1/plugins/installations`, {
      method: 'POST',
      headers: headers(EVIDENCE_IDS[1], 'POST', '/v1/plugins/installations'),
      body: JSON.stringify({
        installationId: INSTALLATION_ID,
        manifest: MANIFEST,
        grantedCapabilities: ['lifeos.calendar.event.v1'],
      }),
    });
    expect(domainInvalid.status).toBe(400);
    expect(await problemBody(domainInvalid)).toMatchObject({
      status: 400,
      code: 'invalid_plugin_operator_request',
    });

    const invalidCredentialPort: PluginCredentialOperatorPort = {
      async bind() {
        throw new PluginCredentialError();
      },
      async revoke() {
        throw new PluginCredentialError();
      },
    };
    const invalidCredential = await startApplication(
      operator(new InMemoryInstallationPort(), invalidCredentialPort),
    );
    const credentialInvalid = await fetch(`${invalidCredential.origin}${bindPath}`, {
      method: 'POST',
      headers: headers(EVIDENCE_IDS[2], 'POST', bindPath),
      body: JSON.stringify({
        credentialBindingId: CREDENTIAL_BINDING_ID,
        installationId: INSTALLATION_ID,
        credentialName: 'provider.access',
        secretValue: CREDENTIAL_VALUE,
      }),
    });
    expect(credentialInvalid.status).toBe(400);
    expect(await problemBody(credentialInvalid)).toMatchObject({
      status: 400,
      code: 'invalid_plugin_operator_request',
    });

    const invalidBody = await fetch(`${invalidCredential.origin}/v1/plugins/installations`, {
      method: 'POST',
      headers: headers(EVIDENCE_IDS[3], 'POST', '/v1/plugins/installations'),
      body: 'null',
    });
    expect(invalidBody.status).toBe(400);
    expect(await problemBody(invalidBody)).toMatchObject({
      status: 400,
      code: 'invalid_plugin_operator_request',
    });

    const unknownInstallationPort: PluginInstallationOperatorPort = {
      async install() {
        throw new Error('dependency detail must stay private');
      },
      async getInstallation() {
        return undefined;
      },
      async revoke() {
        throw new Error('dependency detail must stay private');
      },
    };
    const unknown = await startApplication(operator(unknownInstallationPort));
    const unknownFailure = await fetch(`${unknown.origin}/v1/plugins/installations`, {
      method: 'POST',
      headers: headers(EVIDENCE_IDS[4], 'POST', '/v1/plugins/installations'),
      body: JSON.stringify({
        installationId: INSTALLATION_ID,
        manifest: MANIFEST,
        grantedCapabilities: ['lifeos.calendar.event.v1'],
      }),
    });
    expect(unknownFailure.status).toBe(503);
    const unknownBody = await problemBody(unknownFailure);
    expect(unknownBody).toMatchObject({
      status: 503,
      code: 'plugin_operator_failure',
    });
    expect(JSON.stringify(unknownBody)).not.toContain('dependency detail');
  });

  it('classifies explicit operator context failures independently of HTTP signature construction', async () => {
    const invalidPort: PluginInstallationOperatorPort = {
      async install() {
        throw new IntegrationOperatorContextError('invalid');
      },
      async getInstallation() {
        throw new IntegrationOperatorContextError('invalid');
      },
      async revoke() {
        throw new IntegrationOperatorContextError('unavailable');
      },
    };
    const { origin } = await startApplication(operator(invalidPort));
    const response = await fetch(`${origin}/v1/plugins/installations`, {
      method: 'POST',
      headers: headers(EVIDENCE_IDS[8], 'POST', '/v1/plugins/installations'),
      body: JSON.stringify({
        installationId: INSTALLATION_ID,
        manifest: MANIFEST,
        grantedCapabilities: ['lifeos.calendar.event.v1'],
      }),
    });
    expect(response.status).toBe(401);
    expect(await problemBody(response)).toMatchObject({
      status: 401,
      code: 'invalid_plugin_operator_context',
    });
  });
});