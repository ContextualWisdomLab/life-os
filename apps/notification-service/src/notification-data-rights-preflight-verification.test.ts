import { describe, expect, it } from 'vitest';
import { NotificationDataRightsContributor } from './notification-data-rights';
import type {
  NotificationSqlClient,
  NotificationSqlQueryResult,
} from './postgres-reminder-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

class PreflightClient implements NotificationSqlClient {
  readonly calls: string[] = [];

  constructor(private readonly overrides: Record<string, unknown> = {}) {}

  async query<Row>(
    text: string,
    _values: readonly unknown[],
  ): Promise<NotificationSqlQueryResult<Row>> {
    this.calls.push(text);
    return {
      rows: [
        {
          erasure_function_ready: true,
          replay_select_ready: true,
          replay_insert_ready: true,
          replay_delete_ready: true,
          notification_schema_usage_ready: true,
          reminder_occurrences_select_ready: true,
          reminder_outcomes_select_ready: true,
          inbox_messages_select_ready: true,
          ...this.overrides,
        } as unknown as Row,
      ],
    };
  }
}

function preflightRequest() {
  return {
    contractVersion: 'life-os.data-rights-contributor.v1',
    operation: 'erase_preflight',
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    requestId: REQUEST_ID,
  } as const;
}

const unavailableResponse = {
  contractVersion: 'life-os.data-rights-contributor.v1',
  contributor: 'notification.service',
  operation: 'erase_preflight',
  requestId: REQUEST_ID,
  ready: false,
  blockers: ['notification_erasure_verification_unavailable'],
} as const;

describe('Notification erasure verification preflight', () => {
  it('fails closed before deletion when source-table verification authority is incomplete', async () => {
    const client = new PreflightClient({
      reminder_occurrences_select_ready: false,
    });
    const contributor = new NotificationDataRightsContributor(client);

    await expect(contributor.handle(preflightRequest())).resolves.toEqual(
      unavailableResponse,
    );

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toContain('reminder_occurrences');
    expect(client.calls[0]).toContain('reminder_outcomes');
    expect(client.calls[0]).toContain('inbox_messages');
  });

  it('fails closed when table grants exist but the Notification schema is not usable', async () => {
    const client = new PreflightClient({
      notification_schema_usage_ready: false,
    });
    const contributor = new NotificationDataRightsContributor(client);

    await expect(contributor.handle(preflightRequest())).resolves.toEqual(
      unavailableResponse,
    );

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toContain('has_schema_privilege');
    expect(client.calls[0]).toContain('notification_service');
  });
});
