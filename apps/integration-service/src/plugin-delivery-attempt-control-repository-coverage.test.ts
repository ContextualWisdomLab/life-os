import { describe, expect, it } from 'vitest';
import type { PluginDeliveryAttemptControlCommand } from './plugin-delivery-attempt-control';
import {
  PluginDeliveryAttemptControlPersistenceEvidenceError,
  PluginDeliveryAttemptControlPersistenceValidationError,
  PostgresPluginDeliveryAttemptControlStore,
  type PluginDeliveryAttemptControlSqlClient,
  type PluginDeliveryAttemptControlSqlResult,
} from './plugin-delivery-attempt-control-repository';

const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const OCCURRED_AT = '2026-09-09T03:00:00.000Z';
const TERMINAL_AT = '2026-09-09T02:59:00.000Z';

function command(
  overrides: Partial<PluginDeliveryAttemptControlCommand> = {},
): PluginDeliveryAttemptControlCommand {
  return {
    deliveryId: DELIVERY_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    authority_version: 'life-os.plugin-delivery-attempt-control.v1',
    delivery_id: DELIVERY_ID,
    workspace_id: WORKSPACE_ID,
    requested_by_user_id: USER_ID,
    control_sequence: 1,
    delivery_status: 'paused',
    updated_at: OCCURRED_AT,
    next_attempt_at: OCCURRED_AT,
    terminal_at: null,
    ...overrides,
  };
}

function clientReturning(
  result: unknown,
): PluginDeliveryAttemptControlSqlClient {
  return {
    async query<Row>() {
      return result as PluginDeliveryAttemptControlSqlResult<Row>;
    },
  };
}

async function expectInputError(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toEqual(
    new PluginDeliveryAttemptControlPersistenceValidationError(),
  );
}

async function expectEvidenceError(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toEqual(
    new PluginDeliveryAttemptControlPersistenceEvidenceError(),
  );
}

describe('PostgresPluginDeliveryAttemptControlStore hostile evidence coverage', () => {
  it('rejects malformed and hostile commands before SQL authority is used', async () => {
    let calls = 0;
    const store = new PostgresPluginDeliveryAttemptControlStore({
      async query<Row>() {
        calls += 1;
        return { rows: [] as Row[], rowCount: 0 };
      },
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const throwing = Object.defineProperty({}, 'deliveryId', {
      get() {
        throw new Error('command-detail-must-not-escape');
      },
    });

    for (const candidate of [null, [], revoked.proxy, throwing]) {
      await expectInputError(store.pause(candidate as never));
    }
    for (const candidate of [
      command({ deliveryId: 'not-a-uuid' }),
      command({ workspaceId: 'not-a-uuid' }),
      command({ requestedByUserId: 'not-a-uuid' }),
      command({ occurredAt: 'not-an-instant' }),
      command({ occurredAt: '2026-02-30T03:00:00.000Z' }),
    ]) {
      await expectInputError(store.pause(candidate));
    }
    expect(calls).toBe(0);
  });

  it('bounds SQL dependency failure and malformed result envelopes', async () => {
    const rejecting = new PostgresPluginDeliveryAttemptControlStore({
      async query() {
        throw new Error('database-detail-must-not-escape');
      },
    });
    await expectEvidenceError(rejecting.pause(command()));

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const throwingRows = Object.defineProperty({}, 'rows', {
      get() {
        throw new Error('result-detail-must-not-escape');
      },
    });
    const malformed: unknown[] = [
      null,
      [],
      revoked.proxy,
      throwingRows,
      { rows: {}, rowCount: 0 },
      { rows: [], rowCount: null },
      { rows: [], rowCount: 0.5 },
      { rows: [], rowCount: -1 },
      { rows: [], rowCount: 1 },
      { rows: [row(), row()], rowCount: 2 },
    ];

    for (const result of malformed) {
      await expectEvidenceError(
        new PostgresPluginDeliveryAttemptControlStore(
          clientReturning(result),
        ).pause(command()),
      );
    }

    await expect(
      new PostgresPluginDeliveryAttemptControlStore(
        clientReturning({ rows: [], rowCount: 0 }),
      ).pause(command()),
    ).resolves.toBeUndefined();
  });

  it('rejects hostile rows and authority identity or sequence mismatches', async () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const throwing = Object.defineProperty({}, 'authority_version', {
      get() {
        throw new Error('row-detail-must-not-escape');
      },
    });
    const malformed: unknown[] = [
      null,
      [],
      revoked.proxy,
      throwing,
      row({ authority_version: 'wrong-version' }),
      row({ delivery_id: '66666666-6666-4666-8666-666666666666' }),
      row({ workspace_id: '77777777-7777-4777-8777-777777777777' }),
      row({ requested_by_user_id: '88888888-8888-4888-8888-888888888888' }),
      row({ control_sequence: '1' }),
      row({ control_sequence: 0 }),
      row({ control_sequence: 1.5 }),
    ];

    for (const durable of malformed) {
      await expectEvidenceError(
        new PostgresPluginDeliveryAttemptControlStore(
          clientReturning({ rows: [durable], rowCount: 1 }),
        ).pause(command()),
      );
    }
  });

  it('rejects malformed stored instants and lifecycle contradictions', async () => {
    const invalidDate = new Date('invalid');
    const malformed: unknown[] = [
      row({ updated_at: 'not-an-instant' }),
      row({ updated_at: '2026-02-30T03:00:00.000Z' }),
      row({ updated_at: invalidDate }),
      row({ updated_at: '2026-09-09T03:00:01.000Z' }),
      row({ next_attempt_at: 'not-an-instant' }),
      row({ terminal_at: 'not-an-instant' }),
      row({ delivery_status: 'pending' }),
      row({ next_attempt_at: null }),
      row({ terminal_at: TERMINAL_AT }),
    ];
    for (const durable of malformed) {
      await expectEvidenceError(
        new PostgresPluginDeliveryAttemptControlStore(
          clientReturning({ rows: [durable], rowCount: 1 }),
        ).pause(command()),
      );
    }

    for (const durable of [
      row({ delivery_status: 'paused' }),
      row({
        delivery_status: 'pending',
        next_attempt_at: '2026-09-09T03:00:01.000Z',
      }),
      row({ delivery_status: 'pending', terminal_at: TERMINAL_AT }),
    ]) {
      await expectEvidenceError(
        new PostgresPluginDeliveryAttemptControlStore(
          clientReturning({ rows: [durable], rowCount: 1 }),
        ).resume(command()),
      );
    }

    for (const durable of [
      row({
        delivery_status: 'failed',
        next_attempt_at: null,
        terminal_at: TERMINAL_AT,
      }),
      row({ delivery_status: 'dead_lettered', terminal_at: TERMINAL_AT }),
      row({
        delivery_status: 'dead_lettered',
        next_attempt_at: null,
        terminal_at: null,
      }),
      row({
        delivery_status: 'dead_lettered',
        next_attempt_at: null,
        terminal_at: '2026-09-09T03:00:01.000Z',
      }),
    ]) {
      await expectEvidenceError(
        new PostgresPluginDeliveryAttemptControlStore(
          clientReturning({ rows: [durable], rowCount: 1 }),
        ).deadLetter(command()),
      );
    }
  });

  it('accepts canonical pause, resume, and dead-letter evidence and parameterizes SQL', async () => {
    const calls: Array<{
      text: string;
      values: readonly unknown[] | undefined;
    }> = [];
    const client: PluginDeliveryAttemptControlSqlClient = {
      async query<Row>(text: string, values?: readonly unknown[]) {
        calls.push({ text, values });
        const durable = text.includes("delivery_status = 'paused'")
          ? row()
          : text.includes("delivery_status = 'pending'")
            ? row({ delivery_status: 'pending' })
            : row({
                delivery_status: 'dead_lettered',
                next_attempt_at: null,
                terminal_at: TERMINAL_AT,
              });
        return { rows: [durable as Row], rowCount: 1 };
      },
    };
    const store = new PostgresPluginDeliveryAttemptControlStore(client);

    await expect(store.pause(command())).resolves.toMatchObject({
      controlCode: 'pause',
      deliveryStatus: 'paused',
      deliveryId: DELIVERY_ID,
    });
    await expect(store.resume(command())).resolves.toMatchObject({
      controlCode: 'resume',
      deliveryStatus: 'pending',
    });
    await expect(store.deadLetter(command())).resolves.toMatchObject({
      controlCode: 'dead_letter',
      deliveryStatus: 'dead_lettered',
      terminalAt: TERMINAL_AT,
    });

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.values).toEqual([
        DELIVERY_ID,
        OCCURRED_AT,
        WORKSPACE_ID,
        USER_ID,
      ]);
      expect(call.text).toContain(
        'plugin_integration.plugin_delivery_attempt_record',
      );
    }
  });
});
