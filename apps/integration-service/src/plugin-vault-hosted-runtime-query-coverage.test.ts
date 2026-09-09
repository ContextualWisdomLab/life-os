import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createPluginVaultHostedRuntime,
  type PluginHostedPostgresPool,
} from './plugin-vault-hosted-runtime';
import type { IntegrationOperatorContextHeaders } from './plugin-operator-context';

const CONTEXT_SECRET = 'operator-context-fixture-value-32-bytes-minimum';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const EVIDENCE_ID = '77777777-7777-4777-8777-777777777777';
const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';

function signedHeaders(issuedAt: number): IntegrationOperatorContextHeaders {
  const path = `/v1/plugins/delivery-attempts/${DELIVERY_ID}`;
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    evidenceId: EVIDENCE_ID,
    issuedAt: String(issuedAt),
    signature: createHmac('sha256', CONTEXT_SECRET)
      .update(
        `life-os.integration-operator-context.v1\n${WORKSPACE_ID}\n${USER_ID}\n${EVIDENCE_ID}\n${issuedAt}\nGET\n${path}`,
        'utf8',
      )
      .digest('base64url'),
  });
}

describe('Plugin Vault hosted runtime SQL forwarding', () => {
  it('forwards replay and delivery-status queries through the captured service-owned pool method', async () => {
    const issuedAt = Math.floor(Date.now() / 1_000);
    const requestedAt = new Date((issuedAt - 5) * 1_000).toISOString();
    const query = vi.fn(async (text: string) => {
      if (text.includes('consume_plugin_operator_context_replay')) {
        return { rows: [{ consumed: true }], rowCount: 1 };
      }
      if (text.includes('plugin_delivery_attempt_record')) {
        return {
          rows: [
            {
              authority_version: 'life-os.plugin-delivery-attempt.v1',
              delivery_id: DELIVERY_ID,
              grant_id: GRANT_ID,
              installation_id: INSTALLATION_ID,
              workspace_id: WORKSPACE_ID,
              requested_by_user_id: USER_ID,
              delivery_status: 'pending',
              attempt_count: 0,
              max_attempts: 4,
              requested_at: requestedAt,
              updated_at: requestedAt,
              next_attempt_at: requestedAt,
              terminal_at: null,
              last_outcome_code: null,
              control_sequence: 0,
              has_claim_token_digest: false,
              claim_started_at: null,
              claim_expires_at: null,
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error('unexpected hosted runtime query');
    });
    const end = vi.fn(async () => undefined);
    const pool = { query, end } as PluginHostedPostgresPool;
    const runtime = await createPluginVaultHostedRuntime(
      () => pool,
      Object.freeze({
        INTEGRATION_DATABASE_URL: 'postgresql://runtime.invalid/life_os',
        INTEGRATION_OPERATOR_CONTEXT_SECRET: CONTEXT_SECRET,
        INTEGRATION_PLUGIN_VAULT_ORIGIN: 'https://vault.example.test',
        INTEGRATION_PLUGIN_VAULT_TOKEN: 'vault-fixture-token-value',
        INTEGRATION_PLUGIN_VAULT_MOUNT: 'secret',
      }),
    );

    const status = await runtime.operator.getDeliveryAttemptStatus(
      signedHeaders(issuedAt),
      DELIVERY_ID,
    );

    expect(status).toEqual(
      expect.objectContaining({
        authorityVersion: 'life-os.plugin-delivery-attempt-status.v1',
        deliveryId: DELIVERY_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        deliveryStatus: 'pending',
        claimState: 'unclaimed',
      }),
    );
    expect(query).toHaveBeenCalledTimes(2);
    await runtime.close();
    expect(end).toHaveBeenCalledTimes(1);
  });
});
