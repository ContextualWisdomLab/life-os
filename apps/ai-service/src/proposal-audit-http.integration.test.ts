import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiProductionModule } from './main';

const DATABASE_URL = process.env.AI_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
let administrativePool: Pool;

interface JsonHttpResponse {
  statusCode: number;
  body: unknown;
}

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error('AI_DATABASE_URL is required for integration tests');
  }
  return DATABASE_URL;
}

async function applyMigration(pool: Pool): Promise<void> {
  const sql = await readFile(
    resolve(__dirname, '../migrations/0001_proposal_audit.sql'),
    'utf8',
  );
  await pool.query(sql);
}

function requestJson(
  address: AddressInfo,
  method: 'GET' | 'POST',
  path: string,
  workspaceId: string,
  body?: unknown,
  actorId?: string,
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
          'x-workspace-id': workspaceId,
          ...(actorId === undefined ? {} : { 'x-actor-id': actorId }),
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
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-ai-http-integration-admin',
      max: 4,
    });
    await administrativePool.query('DROP SCHEMA IF EXISTS ai CASCADE');
    await applyMigration(administrativePool);
  });

  afterAll(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS ai CASCADE');
    await administrativePool.end();
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
        workspaceId,
        proposalRequest(taskId),
      );
      expect(created.statusCode).toBe(201);
      expect(created.body).toMatchObject({
        workspaceId,
        requiresConfirmation: true,
      });
      proposalId = (created.body as { proposalId: string }).proposalId;

      const hiddenFromOtherTenant = await requestJson(
        address,
        'GET',
        `/v1/proposals/${proposalId}`,
        otherWorkspaceId,
      );
      expect(hiddenFromOtherTenant).toMatchObject({
        statusCode: 404,
        body: { code: 'proposal_not_found' },
      });

      const unsupportedMutation = await requestJson(
        address,
        'POST',
        '/v1/proposals/apply',
        workspaceId,
        { proposalId },
        actorId,
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
        workspaceId,
      );
      expect(listed.statusCode).toBe(200);
      expect(listed.body).toHaveLength(1);
      const audit = (listed.body as Array<{
        contentDigest: string;
        proposal: { proposalId: string };
      }>)[0];
      expect(audit?.proposal.proposalId).toBe(proposalId);
      if (!audit) {
        throw new Error('Expected persisted proposal audit evidence');
      }

      const decisionBody = {
        expectedContentDigest: audit.contentDigest,
        idempotencyKey: randomUUID(),
        decision: 'accepted',
        reason: 'Reviewed and accepted without executing any operation.',
        decidedAt: '2026-08-04T00:00:02.000Z',
      } as const;
      const accepted = await requestJson(
        address,
        'POST',
        `/v1/proposals/${proposalId}/decisions`,
        workspaceId,
        decisionBody,
        actorId,
      );
      const replayed = await requestJson(
        address,
        'POST',
        `/v1/proposals/${proposalId}/decisions`,
        workspaceId,
        decisionBody,
        actorId,
      );
      expect(accepted.statusCode).toBe(201);
      expect(replayed).toEqual(accepted);

      const history = await requestJson(
        address,
        'GET',
        `/v1/proposals/${proposalId}/decisions`,
        workspaceId,
      );
      expect(history.statusCode).toBe(200);
      expect(history.body).toHaveLength(1);

      const stale = await requestJson(
        address,
        'POST',
        `/v1/proposals/${proposalId}/decisions`,
        workspaceId,
        {
          ...decisionBody,
          idempotencyKey: randomUUID(),
          expectedContentDigest: '0'.repeat(64),
        },
        actorId,
      );
      expect(stale).toMatchObject({
        statusCode: 409,
        body: { code: 'stale_proposal' },
      });

      const conflict = await requestJson(
        address,
        'POST',
        `/v1/proposals/${proposalId}/decisions`,
        workspaceId,
        { ...decisionBody, decision: 'rejected' },
        actorId,
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
