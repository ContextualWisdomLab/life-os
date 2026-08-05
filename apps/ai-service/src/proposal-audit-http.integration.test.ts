import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiProductionModule } from './main';

const TEST_DATABASE_URL = process.env.AI_TEST_DATABASE_URL;
const ORIGINAL_APPLICATION_DATABASE_URL = process.env.AI_DATABASE_URL;
const ORIGINAL_ACTIVE_KEY_ID = process.env.AI_GATEWAY_ACTIVE_KEY_ID;
const ORIGINAL_ACTIVE_KEY_SECRET = process.env.AI_GATEWAY_ACTIVE_KEY_SECRET;
const ORIGINAL_PREVIOUS_KEY_ID = process.env.AI_GATEWAY_PREVIOUS_KEY_ID;
const ORIGINAL_PREVIOUS_KEY_SECRET = process.env.AI_GATEWAY_PREVIOUS_KEY_SECRET;
const ACTIVE_KEY_ID = 'gateway-2026-08-b';
const PREVIOUS_KEY_ID = 'gateway-2026-07-a';
const ACTIVE_KEY_SECRET = Buffer.alloc(32, 0x41).toString('base64url');
const PREVIOUS_KEY_SECRET = Buffer.alloc(32, 0x42).toString('base64url');
const describeWithPostgres = TEST_DATABASE_URL ? describe : describe.skip;
let administrativePool: Pool;

/** Bounded JSON response returned by the local integration-test server. */
interface JsonHttpResponse {
  statusCode: number;
  body: unknown;
}

/** Requires an explicitly disposable PostgreSQL database whose name contains test. */
function requireTestDatabaseUrl(): string {
  if (!TEST_DATABASE_URL) {
    throw new Error('AI_TEST_DATABASE_URL is required for integration tests');
  }
  let parsed: URL;
  try {
    parsed = new URL(TEST_DATABASE_URL);
  } catch {
    throw new Error('AI_TEST_DATABASE_URL is invalid');
  }
  const databaseName = parsed.pathname.slice(1);
  if (
    (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') ||
    !/test/iu.test(databaseName)
  ) {
    throw new Error(
      'AI integration tests require a disposable PostgreSQL test database',
    );
  }
  return TEST_DATABASE_URL;
}

/** Applies the append-only proposal-audit schema to the disposable test database. */
async function applyMigration(pool: Pool): Promise<void> {
  const sql = await readFile(
    resolve(__dirname, '../migrations/0001_proposal_audit.sql'),
    'utf8',
  );
  await pool.query(sql);
}

/** Signs one exact short-lived AI service context. */
function signedContextHeaders(input: {
  workspaceId: string;
  actorId: string;
  method: 'GET' | 'POST';
  path: string;
  issuedAt?: number;
  keyId?: string;
  secret?: string;
}): Readonly<Record<string, string>> {
  const workspaceId = input.workspaceId.toLowerCase();
  const actorId = input.actorId.toLowerCase();
  const issuedAt = String(input.issuedAt ?? Math.floor(Date.now() / 1000));
  const keyId = input.keyId ?? ACTIVE_KEY_ID;
  const signature = createHmac('sha256', input.secret ?? ACTIVE_KEY_SECRET)
    .update(
      `life-os.ai-context.v2\n${keyId}\n${workspaceId}\n${actorId}\n${issuedAt}\n${input.method}\n${input.path}`,
      'utf8',
    )
    .digest('base64url');
  return {
    'x-life-os-context-key-id': keyId,
    'x-life-os-workspace-id': workspaceId,
    'x-life-os-actor-id': actorId,
    'x-life-os-context-issued-at': issuedAt,
    'x-life-os-context-signature': signature,
  };
}

/** Sends one bounded JSON request to the local production module. */
function requestJson(
  address: AddressInfo,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  headers: Readonly<Record<string, string>> = {},
): Promise<JsonHttpResponse> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolveResponse, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path,
        method,
        headers: {
          accept: 'application/json',
          ...headers,
          ...(payload === undefined
            ? {}
            : {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
              }),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolveResponse({
              statusCode: response.statusCode ?? 0,
              body: text ? JSON.parse(text) : null,
            });
          } catch {
            reject(new Error('HTTP response was not valid JSON'));
          }
        });
      },
    );
    request.on('error', reject);
    request.end(payload);
  });
}

/** Creates one valid inert proposal request for the supplied task identifier. */
function proposalRequest(taskId: string): {
  objective: string;
  context: Array<{
    id: string;
    kind: 'task';
    title: string;
    status: 'active';
  }>;
} {
  return {
    objective: 'Ship a durable auditable proposal',
    context: [
      {
        id: taskId,
        kind: 'task',
        title: 'Review the production proposal API',
        status: 'active',
      },
    ],
  };
}

describeWithPostgres('AI production proposal audit HTTP API', () => {
  beforeAll(async () => {
    const testDatabaseUrl = requireTestDatabaseUrl();
    process.env.AI_DATABASE_URL = testDatabaseUrl;
    process.env.AI_GATEWAY_ACTIVE_KEY_ID = ACTIVE_KEY_ID;
    process.env.AI_GATEWAY_ACTIVE_KEY_SECRET = ACTIVE_KEY_SECRET;
    delete process.env.AI_GATEWAY_PREVIOUS_KEY_ID;
    delete process.env.AI_GATEWAY_PREVIOUS_KEY_SECRET;
    administrativePool = new Pool({
      connectionString: testDatabaseUrl,
      application_name: 'life-os-ai-http-integration-admin',
      max: 4,
    });
    await administrativePool.query('DROP SCHEMA IF EXISTS ai CASCADE');
    await applyMigration(administrativePool);
  });

  afterAll(async () => {
    try {
      await administrativePool.query('DROP SCHEMA IF EXISTS ai CASCADE');
      await administrativePool.end();
    } finally {
      if (ORIGINAL_APPLICATION_DATABASE_URL === undefined) {
        delete process.env.AI_DATABASE_URL;
      } else {
        process.env.AI_DATABASE_URL = ORIGINAL_APPLICATION_DATABASE_URL;
      }
      for (const [name, value] of [
        ['AI_GATEWAY_ACTIVE_KEY_ID', ORIGINAL_ACTIVE_KEY_ID],
        ['AI_GATEWAY_ACTIVE_KEY_SECRET', ORIGINAL_ACTIVE_KEY_SECRET],
        ['AI_GATEWAY_PREVIOUS_KEY_ID', ORIGINAL_PREVIOUS_KEY_ID],
        ['AI_GATEWAY_PREVIOUS_KEY_SECRET', ORIGINAL_PREVIOUS_KEY_SECRET],
      ] as const) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  it('rejects unsigned ownership headers and method/path replay', async () => {
    const workspaceId = randomUUID();
    const actorId = randomUUID();
    const taskId = randomUUID();
    const app = await NestFactory.create(AiProductionModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    try {
      const address = app.getHttpServer().address() as AddressInfo;
      const unsigned = await requestJson(
        address,
        'POST',
        '/v1/proposals',
        proposalRequest(taskId),
        { 'x-workspace-id': workspaceId, 'x-actor-id': actorId },
      );
      expect(unsigned).toMatchObject({
        statusCode: 401,
        body: { code: 'invalid_gateway_context' },
      });

      const methodReplay = await requestJson(
        address,
        'POST',
        '/v1/proposals',
        proposalRequest(taskId),
        signedContextHeaders({
          workspaceId,
          actorId,
          method: 'GET',
          path: '/v1/proposals',
        }),
      );
      expect(methodReplay).toMatchObject({
        statusCode: 401,
        body: { code: 'invalid_gateway_context' },
      });

      const pathReplay = await requestJson(
        address,
        'POST',
        '/v1/proposals',
        proposalRequest(taskId),
        signedContextHeaders({
          workspaceId,
          actorId,
          method: 'POST',
          path: `/v1/proposals/${randomUUID()}`,
        }),
      );
      expect(pathReplay).toMatchObject({
        statusCode: 401,
        body: { code: 'invalid_gateway_context' },
      });
    } finally {
      await app.close();
    }
  });

  it('accepts the previous key during overlap and rejects it immediately after retirement', async () => {
    const workspaceId = randomUUID();
    const actorId = randomUUID();
    process.env.AI_GATEWAY_ACTIVE_KEY_ID = ACTIVE_KEY_ID;
    process.env.AI_GATEWAY_ACTIVE_KEY_SECRET = ACTIVE_KEY_SECRET;
    process.env.AI_GATEWAY_PREVIOUS_KEY_ID = PREVIOUS_KEY_ID;
    process.env.AI_GATEWAY_PREVIOUS_KEY_SECRET = PREVIOUS_KEY_SECRET;
    const app = await NestFactory.create(AiProductionModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    try {
      const address = app.getHttpServer().address() as AddressInfo;
      const previousAccepted = await requestJson(
        address,
        'POST',
        '/v1/proposals',
        proposalRequest(randomUUID()),
        signedContextHeaders({
          workspaceId,
          actorId,
          method: 'POST',
          path: '/v1/proposals',
          keyId: PREVIOUS_KEY_ID,
          secret: PREVIOUS_KEY_SECRET,
        }),
      );
      expect(previousAccepted.statusCode).toBe(201);

      delete process.env.AI_GATEWAY_PREVIOUS_KEY_ID;
      delete process.env.AI_GATEWAY_PREVIOUS_KEY_SECRET;
      const retiredRejected = await requestJson(
        address,
        'POST',
        '/v1/proposals',
        proposalRequest(randomUUID()),
        signedContextHeaders({
          workspaceId,
          actorId,
          method: 'POST',
          path: '/v1/proposals',
          keyId: PREVIOUS_KEY_ID,
          secret: PREVIOUS_KEY_SECRET,
        }),
      );
      expect(retiredRejected).toMatchObject({
        statusCode: 401,
        body: { code: 'invalid_gateway_context' },
      });

      const activeAccepted = await requestJson(
        address,
        'POST',
        '/v1/proposals',
        proposalRequest(randomUUID()),
        signedContextHeaders({
          workspaceId,
          actorId,
          method: 'POST',
          path: '/v1/proposals',
        }),
      );
      expect(activeAccepted.statusCode).toBe(201);
    } finally {
      await app.close();
      process.env.AI_GATEWAY_ACTIVE_KEY_ID = ACTIVE_KEY_ID;
      process.env.AI_GATEWAY_ACTIVE_KEY_SECRET = ACTIVE_KEY_SECRET;
      delete process.env.AI_GATEWAY_PREVIOUS_KEY_ID;
      delete process.env.AI_GATEWAY_PREVIOUS_KEY_SECRET;
    }
  });

  it('persists proposals across restarts and appends replay-safe decisions', async () => {
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const actorId = randomUUID();
    const taskId = randomUUID();
    const firstApp = await NestFactory.create(AiProductionModule, {
      logger: false,
    });
    await firstApp.listen(0, '127.0.0.1');
    let proposalId: string | undefined;
    try {
      const address = firstApp.getHttpServer().address() as AddressInfo;
      const created = await requestJson(
        address,
        'POST',
        '/v1/proposals',
        proposalRequest(taskId),
        signedContextHeaders({
          workspaceId,
          actorId,
          method: 'POST',
          path: '/v1/proposals',
        }),
      );
      expect(created.statusCode).toBe(201);
      expect(created.body).toMatchObject({
        workspaceId,
        requiresConfirmation: true,
      });
      proposalId = (created.body as { proposalId: string }).proposalId;

      const proposalPath = `/v1/proposals/${proposalId}`;
      const hiddenFromOtherTenant = await requestJson(
        address,
        'GET',
        proposalPath,
        undefined,
        signedContextHeaders({
          workspaceId: otherWorkspaceId,
          actorId,
          method: 'GET',
          path: proposalPath,
        }),
      );
      expect(hiddenFromOtherTenant).toMatchObject({
        statusCode: 404,
        body: { code: 'proposal_not_found' },
      });

      const unsupportedMutation = await requestJson(
        address,
        'POST',
        '/v1/proposals/apply',
        { proposalId },
        signedContextHeaders({
          workspaceId,
          actorId,
          method: 'POST',
          path: '/v1/proposals',
        }),
      );
      expect(unsupportedMutation.statusCode).toBe(404);
    } finally {
      await firstApp.close();
    }
    if (!proposalId) {
      throw new Error('Expected generated proposal identifier');
    }

    const restartedApp = await NestFactory.create(AiProductionModule, {
      logger: false,
    });
    await restartedApp.listen(0, '127.0.0.1');
    try {
      const address = restartedApp.getHttpServer().address() as AddressInfo;
      const listed = await requestJson(
        address,
        'GET',
        '/v1/proposals',
        undefined,
        signedContextHeaders({
          workspaceId,
          actorId,
          method: 'GET',
          path: '/v1/proposals',
        }),
      );
      expect(listed.statusCode).toBe(200);
      expect(listed.body).toHaveLength(1);
      const audit = (
        listed.body as Array<{
          contentDigest: string;
          proposal: { proposalId: string };
        }>
      )[0];
      if (!audit) {
        throw new Error('Expected persisted proposal audit evidence');
      }
      expect(audit.proposal.proposalId).toBe(proposalId);

      const decisionBody = {
        expectedContentDigest: audit.contentDigest,
        idempotencyKey: randomUUID(),
        decision: 'accepted',
        reason: 'Reviewed and accepted without executing any operation.',
        decidedAt: '2026-08-04T00:00:02.000Z',
      } as const;
      const decisionsPath = `/v1/proposals/${proposalId}/decisions`;
      const decisionHeaders = signedContextHeaders({
        workspaceId,
        actorId,
        method: 'POST',
        path: decisionsPath,
      });
      const accepted = await requestJson(
        address,
        'POST',
        decisionsPath,
        decisionBody,
        decisionHeaders,
      );
      const replayed = await requestJson(
        address,
        'POST',
        decisionsPath,
        decisionBody,
        decisionHeaders,
      );
      expect(accepted.statusCode).toBe(201);
      expect(replayed).toEqual(accepted);

      const history = await requestJson(
        address,
        'GET',
        decisionsPath,
        undefined,
        signedContextHeaders({
          workspaceId,
          actorId,
          method: 'GET',
          path: decisionsPath,
        }),
      );
      expect(history.statusCode).toBe(200);
      expect(history.body).toHaveLength(1);

      const stale = await requestJson(
        address,
        'POST',
        decisionsPath,
        {
          ...decisionBody,
          idempotencyKey: randomUUID(),
          expectedContentDigest: '0'.repeat(64),
        },
        decisionHeaders,
      );
      expect(stale).toMatchObject({
        statusCode: 409,
        body: { code: 'stale_proposal' },
      });

      const conflict = await requestJson(
        address,
        'POST',
        decisionsPath,
        { ...decisionBody, decision: 'rejected' },
        decisionHeaders,
      );
      expect(conflict).toMatchObject({
        statusCode: 409,
        body: { code: 'idempotency_conflict' },
      });
    } finally {
      await restartedApp.close();
    }
  });
});
