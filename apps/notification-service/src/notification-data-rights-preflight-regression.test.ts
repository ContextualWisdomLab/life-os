import { describe, expect, it } from 'vitest';
import { NotificationDataRightsContributor } from './notification-data-rights';
import type {
  NotificationSqlClient,
  NotificationSqlQueryResult,
} from './postgres-reminder-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

/** Captures the exact preflight query and returns one reviewed privilege row. */
class PreflightClient implements NotificationSqlClient {
  readonly calls: Array<{
    readonly text: string;
    readonly values: readonly unknown[];
  }> = [];

  constructor(
    private readonly privilegeRow: Readonly<Record<string, unknown>>,
  ) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<NotificationSqlQueryResult<Row>> {
    this.calls.push({ text, values: [...values] });
    return { rows: [this.privilegeRow as Row] };
  }
}

/** Builds the exact tenant-scoped preflight request accepted by Notification. */
function preflightRequest(): Record<string, unknown> {
  return {
    contractVersion: 'life-os.data-rights-contributor.v1',
    operation: 'erase_preflight',
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    requestId: REQUEST_ID,
  };
}

describe('Notification erasure preflight privilege completeness', () => {
  it('refuses readiness when replay-store authority required by erase is missing', async () => {
    const client = new PreflightClient({
      erasure_function_ready: true,
      replay_select_ready: true,
      replay_insert_ready: false,
      replay_delete_ready: true,
    });
    const contributor = new NotificationDataRightsContributor(client);

    await expect(contributor.handle(preflightRequest())).resolves.toEqual({
      contractVersion: 'life-os.data-rights-contributor.v1',
      contributor: 'notification.service',
      operation: 'erase_preflight',
      requestId: REQUEST_ID,
      ready: false,
      blockers: ['notification_data_rights_replay_store_unavailable'],
    });

    expect(client.calls).toHaveLength(1);
    const query = client.calls[0]?.text ?? '';
    expect(query).toContain('has_function_privilege');
    expect(query).toContain('has_table_privilege');
    expect(query).toContain('data_rights_authority_replay_records');
    expect(query).toContain("'SELECT'");
    expect(query).toContain("'INSERT'");
    expect(query).toContain("'DELETE'");
  });
});
