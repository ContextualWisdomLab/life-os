import { createHmac, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PLUGIN_CONTRACT_VERSION,
  type PluginManifest,
} from '@life-os/plugin-sdk';
import { PluginCredentialError } from './plugin-credential';
import { createNodePostgresPluginPool } from './plugin-vault-postgres-driver';
import {
  createPluginVaultHostedRuntime,
  type PluginHostedPostgresPool,
  type PluginVaultHostedRuntime,
} from './plugin-vault-hosted-runtime';
import {
  PluginVaultSecretStore,
  PluginVaultSecretStoreError,
} from './plugin-vault-secret-store';

const DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
const VAULT_ORIGIN = process.env.INTEGRATION_PLUGIN_VAULT_ORIGIN;
const VAULT_TOKEN = process.env.INTEGRATION_PLUGIN_VAULT_TOKEN;
const VAULT_MOUNT = process.env.INTEGRATION_PLUGIN_VAULT_MOUNT;
const OPERATOR_CONTEXT_SECRET = process.env.INTEGRATION_OPERATOR_CONTEXT_SECRET;
const REAL_VAULT_POSTGRES_ACCEPTANCE =
  process.env.INTEGRATION_VAULT_POSTGRES_ACCEPTANCE === '1';
const describeWithRealVaultAndPostgres =
  REAL_VAULT_POSTGRES_ACCEPTANCE &&
  DATABASE_URL &&
  VAULT_ORIGIN &&
  VAULT_TOKEN &&
  VAULT_MOUNT &&
  OPERATOR_CONTEXT_SECRET
    ? describe
    : describe.skip;

const TASK_COMPLETED = 'lifeos.task.completed.v1';
const TEST_SECRET = 'integration-only-plugin-secret-material';
const MANIFEST: PluginManifest = Object.freeze({
  pluginId: 'com.example.lifeos-vault-acceptance',
  displayName: 'LifeOS Vault Acceptance',
  contractVersion: PLUGIN_CONTRACT_VERSION,
  subscriptions: Object.freeze([TASK_COMPLETED]),
});

interface CredentialEvidenceRow {
  readonly credential_status: string;
  readonly secret_reference: string;
  readonly revoked_at: Date | null;
}

let runtime: PluginVaultHostedRuntime | undefined;
let restartedRuntime: PluginVaultHostedRuntime | undefined;
let observer: PluginHostedPostgresPool | undefined;
let cleanupSecretStore: PluginVaultSecretStore | undefined;
let cleanupReference: string | undefined;

afterEach(async () => {
  if (cleanupSecretStore !== undefined && cleanupReference !== undefined) {
    try {
      await cleanupSecretStore.deleteSecret(cleanupReference);
    } catch {
      // The acceptance assertion remains authoritative; cleanup is best effort for a disposable Vault.
    }
  }
  cleanupSecretStore = undefined;
  cleanupReference = undefined;

  const currentRestarted = restartedRuntime;
  restartedRuntime = undefined;
  if (currentRestarted !== undefined) {
    try {
      await currentRestarted.close();
    } catch {
      // Preserve the original acceptance failure while still attempting all owned cleanup.
    }
  }

  const currentRuntime = runtime;
  runtime = undefined;
  if (currentRuntime !== undefined) {
    try {
      await currentRuntime.close();
    } catch {
      // Preserve the original acceptance failure while still attempting the observer cleanup.
    }
  }

  const currentObserver = observer;
  observer = undefined;
  if (currentObserver !== undefined) {
    try {
      await currentObserver.end();
    } catch {
      // Disposable acceptance infrastructure is torn down by the workflow after this test.
    }
  }
});

function signedHeaders(
  workspaceId: string,
  userId: string,
  method: 'GET' | 'POST',
  path: string,
) {
  const evidenceId = randomUUID();
  const issuedAt = Math.floor(Date.now() / 1_000).toString();
  const signature = createHmac('sha256', OPERATOR_CONTEXT_SECRET!)
    .update(
      `life-os.integration-operator-context.v1\n${workspaceId}\n${userId}\n${evidenceId}\n${issuedAt}\n${method}\n${path}`,
      'utf8',
    )
    .digest('base64url');

  return Object.freeze({
    workspaceId,
    userId,
    evidenceId,
    issuedAt,
    signature,
  });
}

async function credentialEvidence(
  pool: PluginHostedPostgresPool,
  credentialBindingId: string,
  workspaceId: string,
  userId: string,
): Promise<CredentialEvidenceRow> {
  const result = await pool.query<CredentialEvidenceRow>(
    `SELECT credential_status, secret_reference, revoked_at
     FROM plugin_integration.plugin_credential_binding_record
     WHERE credential_binding_id = $1::uuid
       AND workspace_id = $2::uuid
       AND installed_by_user_id = $3::uuid`,
    [credentialBindingId, workspaceId, userId],
  );
  expect(result.rowCount).toBe(1);
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!;
}

describeWithRealVaultAndPostgres(
  'Integration hosted Vault and PostgreSQL durable acceptance',
  () => {
    it('survives restart between installation revocation and idempotent credential cleanup', async () => {
      const workspaceId = randomUUID();
      const userId = randomUUID();
      const installationId = randomUUID();
      const credentialBindingId = randomUUID();
      const secretReference = `lifeos-plugin-vault://${credentialBindingId}`;
      const credentialInput = Object.freeze({
        credentialBindingId,
        installationId,
        credentialName: 'api_token',
        secretValue: TEST_SECRET,
      });

      runtime = await createPluginVaultHostedRuntime(
        createNodePostgresPluginPool,
        process.env,
      );
      observer = await createNodePostgresPluginPool(DATABASE_URL!);
      const secretStore = new PluginVaultSecretStore(
        VAULT_ORIGIN!,
        VAULT_TOKEN!,
        VAULT_MOUNT!,
      );
      cleanupSecretStore = secretStore;
      cleanupReference = secretReference;

      const installed = await runtime.operator.install(
        signedHeaders(
          workspaceId,
          userId,
          'POST',
          '/v1/plugins/installations',
        ),
        {
          installationId,
          manifest: MANIFEST,
          grantedCapabilities: [TASK_COMPLETED],
        },
      );
      expect(installed).toMatchObject({
        installationId,
        workspaceId,
        installedByUserId: userId,
        status: 'active',
        revokedAt: null,
      });

      const bound = await runtime.operator.bindCredential(
        signedHeaders(
          workspaceId,
          userId,
          'POST',
          '/v1/plugins/credential-bindings',
        ),
        credentialInput,
      );
      const replay = await runtime.operator.bindCredential(
        signedHeaders(
          workspaceId,
          userId,
          'POST',
          '/v1/plugins/credential-bindings',
        ),
        credentialInput,
      );
      expect(replay).toEqual(bound);

      const durableActive = await credentialEvidence(
        observer,
        credentialBindingId,
        workspaceId,
        userId,
      );
      expect(durableActive).toMatchObject({
        credential_status: 'active',
        secret_reference: secretReference,
        revoked_at: null,
      });
      await expect(
        secretStore.verifySecret(secretReference, {
          credentialBindingId,
          installationId,
          workspaceId,
          installedByUserId: userId,
          credentialName: credentialInput.credentialName,
          secretValue: TEST_SECRET,
        }),
      ).resolves.toBeUndefined();

      const revokedInstallation = await runtime.operator.revokeInstallation(
        signedHeaders(
          workspaceId,
          userId,
          'POST',
          `/v1/plugins/installations/${installationId}/revoke`,
        ),
        installationId,
      );
      expect(revokedInstallation).toMatchObject({
        installationId,
        status: 'revoked',
      });

      await expect(
        runtime.operator.bindCredential(
          signedHeaders(
            workspaceId,
            userId,
            'POST',
            '/v1/plugins/credential-bindings',
          ),
          credentialInput,
        ),
      ).rejects.toBeInstanceOf(PluginCredentialError);

      await runtime.close();
      runtime = undefined;
      restartedRuntime = await createPluginVaultHostedRuntime(
        createNodePostgresPluginPool,
        process.env,
      );

      const revokedCredential =
        await restartedRuntime.operator.revokeCredential(
          signedHeaders(
            workspaceId,
            userId,
            'POST',
            `/v1/plugins/credential-bindings/${credentialBindingId}/revoke`,
          ),
          credentialBindingId,
        );
      expect(revokedCredential).toMatchObject({
        credentialBindingId,
        installationId,
        workspaceId,
        installedByUserId: userId,
        status: 'revoked',
      });

      const cleanupReplay = await restartedRuntime.operator.revokeCredential(
        signedHeaders(
          workspaceId,
          userId,
          'POST',
          `/v1/plugins/credential-bindings/${credentialBindingId}/revoke`,
        ),
        credentialBindingId,
      );
      expect(cleanupReplay).toEqual(revokedCredential);

      const durableRevoked = await credentialEvidence(
        observer,
        credentialBindingId,
        workspaceId,
        userId,
      );
      expect(durableRevoked.credential_status).toBe('revoked');
      expect(durableRevoked.secret_reference).toBe(secretReference);
      expect(durableRevoked.revoked_at).toBeInstanceOf(Date);

      await expect(
        secretStore.verifySecret(secretReference, {
          credentialBindingId,
          installationId,
          workspaceId,
          installedByUserId: userId,
          credentialName: credentialInput.credentialName,
          secretValue: TEST_SECRET,
        }),
      ).rejects.toBeInstanceOf(PluginVaultSecretStoreError);
      cleanupReference = undefined;
    }, 30_000);
  },
);
