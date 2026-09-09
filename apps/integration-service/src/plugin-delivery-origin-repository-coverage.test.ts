import { describe, expect, it } from 'vitest';
import type {
  PluginDeliveryOriginGrantRecord,
  RevokePluginDeliveryOriginGrant,
} from './plugin-delivery-origin-authority';
import {
  PluginDeliveryOriginPersistenceEvidenceError,
  PluginDeliveryOriginPersistenceValidationError,
  PostgresPluginDeliveryOriginGrantStore,
  type PluginDeliveryOriginSqlClient,
  type PluginDeliveryOriginSqlResult,
} from './plugin-delivery-origin-repository';

const ACTIVE_GRANT: PluginDeliveryOriginGrantRecord = Object.freeze({
  authorityVersion: 'life-os.plugin-delivery-origin.v1',
  grantId: '11111111-1111-4111-8111-111111111111',
  installationId: '22222222-2222-4222-8222-222222222222',
  workspaceId: '33333333-3333-4333-8333-333333333333',
  grantedByUserId: '44444444-4444-4444-8444-444444444444',
  origin: 'https://api.example.com:8443',
  status: 'active',
  grantedAt: '2026-09-01T20:00:00.000Z',
  revokedAt: null,
});
const REVOKED_AT = '2026-09-01T21:00:00.000Z';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[] | undefined;
}

class ScriptedSqlClient implements PluginDeliveryOriginSqlClient {
  readonly calls: QueryCall[] = [];

  constructor(private readonly script: unknown[]) {}

  async query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PluginDeliveryOriginSqlResult<Row>> {
    this.calls.push({ text, values });
    const next = this.script.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next as PluginDeliveryOriginSqlResult<Row>;
  }
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    authority_version: ACTIVE_GRANT.authorityVersion,
    grant_id: ACTIVE_GRANT.grantId,
    installation_id: ACTIVE_GRANT.installationId,
    workspace_id: ACTIVE_GRANT.workspaceId,
    granted_by_user_id: ACTIVE_GRANT.grantedByUserId,
    origin_uri: ACTIVE_GRANT.origin,
    grant_status: ACTIVE_GRANT.status,
    granted_at: new Date(ACTIVE_GRANT.grantedAt),
    revoked_at: null,
    ...overrides,
  };
}

function result(
  rows: readonly Record<string, unknown>[],
  rowCount: number | null = rows.length,
): PluginDeliveryOriginSqlResult<Record<string, unknown>> {
  return { rows, rowCount };
}

function storeFor(...script: unknown[]): PostgresPluginDeliveryOriginGrantStore {
  return new PostgresPluginDeliveryOriginGrantStore(
    new ScriptedSqlClient([...script]),
  );
}

function revocation(
  overrides: Partial<RevokePluginDeliveryOriginGrant> = {},
): RevokePluginDeliveryOriginGrant {
  return {
    grantId: ACTIVE_GRANT.grantId,
    installationId: ACTIVE_GRANT.installationId,
    workspaceId: ACTIVE_GRANT.workspaceId,
    grantedByUserId: ACTIVE_GRANT.grantedByUserId,
    revokedAt: REVOKED_AT,
    ...overrides,
  };
}

async function expectValidationFailure(
  record: unknown,
): Promise<void> {
  const client = new ScriptedSqlClient([]);
  const store = new PostgresPluginDeliveryOriginGrantStore(client);
  await expect(
    store.createIfAbsent(record as PluginDeliveryOriginGrantRecord),
  ).rejects.toBeInstanceOf(PluginDeliveryOriginPersistenceValidationError);
  expect(client.calls).toHaveLength(0);
}

async function expectEvidenceFailure(
  durableRow: unknown,
): Promise<void> {
  const store = storeFor({ rows: [durableRow], rowCount: 1 });
  await expect(
    store.findById(
      ACTIVE_GRANT.grantId,
      ACTIVE_GRANT.installationId,
      ACTIVE_GRANT.workspaceId,
      ACTIVE_GRANT.grantedByUserId,
    ),
  ).rejects.toBeInstanceOf(PluginDeliveryOriginPersistenceEvidenceError);
}

describe('PostgresPluginDeliveryOriginGrantStore coverage boundaries', () => {
  it('rejects malformed create envelopes, authority lifecycle, identifiers, instants, and origins before SQL', async () => {
    const invalidRecords: unknown[] = [
      null,
      [],
      { ...ACTIVE_GRANT, authorityVersion: 'life-os.plugin-delivery-origin.v2' },
      { ...ACTIVE_GRANT, status: 'revoked' },
      { ...ACTIVE_GRANT, revokedAt: REVOKED_AT },
      { ...ACTIVE_GRANT, installationId: 'not-a-uuid' },
      { ...ACTIVE_GRANT, workspaceId: 'not-a-uuid' },
      { ...ACTIVE_GRANT, grantedByUserId: 'not-a-uuid' },
      { ...ACTIVE_GRANT, grantedAt: 'not-an-instant' },
      { ...ACTIVE_GRANT, grantedAt: '2026-02-31T20:00:00.000Z' },
      { ...ACTIVE_GRANT, origin: 42 },
      { ...ACTIVE_GRANT, origin: 'https://a' },
      { ...ACTIVE_GRANT, origin: `https://${'a'.repeat(510)}` },
      { ...ACTIVE_GRANT, origin: 'https://api.example.com\n' },
      { ...ACTIVE_GRANT, origin: 'http://api.example.com' },
      { ...ACTIVE_GRANT, origin: 'https://127.0.0.1' },
      { ...ACTIVE_GRANT, origin: 'https://[::1]' },
      { ...ACTIVE_GRANT, origin: 'https://api.example.com/path' },
      { ...ACTIVE_GRANT, origin: 'https://api.example.com?query=1' },
      { ...ACTIVE_GRANT, origin: 'https://api.example.com#fragment' },
      { ...ACTIVE_GRANT, origin: 'https://api.example.com:0' },
      { ...ACTIVE_GRANT, origin: 'https://API.example.com' },
    ];

    for (const record of invalidRecords) {
      await expectValidationFailure(record);
    }
  });

  it('rejects malformed SQL result envelopes without accepting ambiguous durable evidence', async () => {
    const invalidResults: unknown[] = [
      null,
      [],
      { rows: 'not-an-array', rowCount: 0 },
      { rows: [], rowCount: null },
      { rows: [], rowCount: 0.5 },
      { rows: [], rowCount: -1 },
      { rows: [], rowCount: 1 },
      { rows: [row(), row()], rowCount: 2 },
      { rows: [undefined], rowCount: 1 },
    ];

    for (const durableResult of invalidResults) {
      const store = storeFor(durableResult);
      await expect(
        store.findById(
          ACTIVE_GRANT.grantId,
          ACTIVE_GRANT.installationId,
          ACTIVE_GRANT.workspaceId,
          ACTIVE_GRANT.grantedByUserId,
        ),
      ).rejects.toBeInstanceOf(PluginDeliveryOriginPersistenceEvidenceError);
    }
  });

  it('rejects malformed persisted identities, instants, origin authority, status, and lifecycle evidence', async () => {
    const invalidRows: unknown[] = [
      null,
      [],
      row({ authority_version: 'life-os.plugin-delivery-origin.v2' }),
      row({ grant_status: 'unknown' }),
      row({ grant_id: 42 }),
      row({ installation_id: 42 }),
      row({ workspace_id: 42 }),
      row({ granted_by_user_id: 42 }),
      row({ granted_at: new Date(Number.NaN) }),
      row({ granted_at: 42 }),
      row({ granted_at: 'not-an-instant' }),
      row({ granted_at: '2026-02-31T20:00:00.000Z' }),
      row({ origin_uri: 42 }),
      row({ origin_uri: 'https://127.0.0.1' }),
      row({ grant_status: 'active', revoked_at: new Date(REVOKED_AT) }),
      row({ grant_status: 'revoked', revoked_at: null }),
      row({
        grant_status: 'revoked',
        granted_at: new Date(REVOKED_AT),
        revoked_at: new Date(ACTIVE_GRANT.grantedAt),
      }),
    ];

    for (const durableRow of invalidRows) {
      await expectEvidenceFailure(durableRow);
    }
  });

  it('returns undefined for an absent scoped read and rejects durable scope substitution', async () => {
    await expect(
      storeFor(result([])).findById(
        ACTIVE_GRANT.grantId,
        ACTIVE_GRANT.installationId,
        ACTIVE_GRANT.workspaceId,
        ACTIVE_GRANT.grantedByUserId,
      ),
    ).resolves.toBeUndefined();

    for (const substituted of [
      row({ grant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      row({ installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      row({ workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      row({ granted_by_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    ]) {
      await expectEvidenceFailure(substituted);
    }
  });

  it('fails closed when create conflict replay evidence is absent', async () => {
    await expect(
      storeFor(result([]), result([])).createIfAbsent(ACTIVE_GRANT),
    ).rejects.toBeInstanceOf(PluginDeliveryOriginPersistenceEvidenceError);
  });

  it('validates revocation input before SQL and returns undefined when no active or replay row exists', async () => {
    for (const invalid of [
      null,
      [],
      revocation({ grantId: 'not-a-uuid' }),
      revocation({ installationId: 'not-a-uuid' }),
      revocation({ workspaceId: 'not-a-uuid' }),
      revocation({ grantedByUserId: 'not-a-uuid' }),
      revocation({ revokedAt: 'not-an-instant' }),
    ]) {
      const client = new ScriptedSqlClient([]);
      const store = new PostgresPluginDeliveryOriginGrantStore(client);
      await expect(
        store.revokeActive(invalid as RevokePluginDeliveryOriginGrant),
      ).rejects.toBeInstanceOf(PluginDeliveryOriginPersistenceValidationError);
      expect(client.calls).toHaveLength(0);
    }

    await expect(
      storeFor(result([]), result([])).revokeActive(revocation()),
    ).resolves.toBeUndefined();
  });

  it('accepts direct revoked update evidence and rejects substituted replay authority', async () => {
    const revokedRow = row({
      grant_status: 'revoked',
      revoked_at: new Date(REVOKED_AT),
    });
    await expect(
      storeFor(result([revokedRow])).revokeActive(revocation()),
    ).resolves.toEqual({
      ...ACTIVE_GRANT,
      status: 'revoked',
      revokedAt: REVOKED_AT,
    });

    for (const substituted of [
      { ...revokedRow, grant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      {
        ...revokedRow,
        installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      { ...revokedRow, workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      {
        ...revokedRow,
        granted_by_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      { ...revokedRow, grant_status: 'active', revoked_at: null },
    ]) {
      await expect(
        storeFor(result([]), result([substituted])).revokeActive(revocation()),
      ).rejects.toBeInstanceOf(PluginDeliveryOriginPersistenceEvidenceError);
    }
  });
});
