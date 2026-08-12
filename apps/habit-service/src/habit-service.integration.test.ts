import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { HabitRuntime } from './habit-runtime';
import { AppModule, HABIT_RUNTIME } from './main';

const DATABASE_URL = process.env.HABIT_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe.sequential : describe.skip;
const TEST_CONTEXT_SECRET = randomBytes(32).toString('base64url');
let administrativePool: Pool;
const activeApplications: INestApplication[] = [];

interface TestHarness {
  app: INestApplication;
  baseUrl: string;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  workspaceId?: string;
  body?: unknown;
}

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error('HABIT_DATABASE_URL is required for integration tests');
  }
  return DATABASE_URL;
}

async function applyMigration(pool: Pool): Promise<void> {
  const sql = await readFile(
    resolve(__dirname, '../migrations/0001_recurring_habit_core.sql'),
    'utf8',
  );
  await pool.query(sql);
}

async function createHarness(): Promise<TestHarness> {
  process.env.HABIT_DATABASE_URL = requireDatabaseUrl();
  process.env.HABIT_GATEWAY_CONTEXT_SECRET = TEST_CONTEXT_SECRET;
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  await app.listen(0, '127.0.0.1');
  activeApplications.push(app);
  const address = app.getHttpServer().address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeHarness(harness: TestHarness): Promise<void> {
  const index = activeApplications.indexOf(harness.app);
  if (index >= 0) {
    activeApplications.splice(index, 1);
  }
  await harness.app.close();
}

function signedWorkspaceHeaders(workspaceId: string): Headers {
  const issuedAt = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', TEST_CONTEXT_SECRET)
    .update(
      `life-os.workspace.v1\n${workspaceId.toLowerCase()}\n${issuedAt}`,
      'utf8',
    )
    .digest('base64url');
  return new Headers({
    'x-life-os-workspace-id': workspaceId,
    'x-life-os-context-issued-at': issuedAt,
    'x-life-os-context-signature': signature,
  });
}

async function request(
  baseUrl: string,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const headers = options.workspaceId
    ? signedWorkspaceHeaders(options.workspaceId)
    : new Headers();
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  return await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? null : JSON.stringify(options.body),
  });
}

describeWithPostgres('Habit service HTTP integration', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-habit-http-integration-admin',
      max: 4,
    });
  });

  beforeEach(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS habit CASCADE');
    await applyMigration(administrativePool);
  });

  afterEach(async () => {
    await Promise.all(activeApplications.splice(0).map((app) => app.close()));
  });

  afterAll(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS habit CASCADE');
    await administrativePool.end();
  });

  it('persists a tenant-safe recurring habit and immutable completion lifecycle', async () => {
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const idempotencyKey = randomUUID();
    const firstHarness = await createHarness();

    const create = await request(firstHarness.baseUrl, '/v1/habits', {
      method: 'POST',
      workspaceId,
      body: {
        title: 'Review weekly priorities',
        timezone: 'Asia/Seoul',
        startsOn: '2026-08-03',
        recurrence: { kind: 'weekly', interval: 1, weekdays: [5, 1, 1] },
      },
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as {
      id: string;
      recurrence: { weekdays: number[] };
    };
    expect(created.recurrence.weekdays).toEqual([1, 5]);

    const ownList = await request(firstHarness.baseUrl, '/v1/habits', {
      workspaceId,
    });
    expect(ownList.status).toBe(200);
    expect(await ownList.json()).toEqual([
      expect.objectContaining({ id: created.id, workspaceId }),
    ]);

    const otherList = await request(firstHarness.baseUrl, '/v1/habits', {
      workspaceId: otherWorkspaceId,
    });
    expect(otherList.status).toBe(200);
    expect(await otherList.json()).toEqual([]);

    const occurrences = await request(
      firstHarness.baseUrl,
      `/v1/habits/${created.id}/occurrences?from=2026-08-03&to=2026-08-09`,
      { workspaceId },
    );
    expect(occurrences.status).toBe(200);
    expect(await occurrences.json()).toEqual([
      {
        habitId: created.id,
        workspaceId,
        scheduledLocalDate: '2026-08-03',
      },
      {
        habitId: created.id,
        workspaceId,
        scheduledLocalDate: '2026-08-07',
      },
    ]);

    const completionBody = {
      scheduledLocalDate: '2026-08-03',
      completedAt: '2026-08-03T12:00:00.000Z',
      idempotencyKey,
    };
    const completion = await request(
      firstHarness.baseUrl,
      `/v1/habits/${created.id}/completions`,
      { method: 'POST', workspaceId, body: completionBody },
    );
    expect(completion.status).toBe(201);
    const completed = (await completion.json()) as { id: string };

    const replay = await request(
      firstHarness.baseUrl,
      `/v1/habits/${created.id}/completions`,
      { method: 'POST', workspaceId, body: completionBody },
    );
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(
      expect.objectContaining({ id: completed.id, idempotencyKey }),
    );

    const conflict = await request(
      firstHarness.baseUrl,
      `/v1/habits/${created.id}/completions`,
      {
        method: 'POST',
        workspaceId,
        body: {
          ...completionBody,
          completedAt: '2026-08-03T13:00:00.000Z',
        },
      },
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      status: 409,
      code: 'idempotency_conflict',
    });

    await closeHarness(firstHarness);
    const restartedHarness = await createHarness();
    const history = await request(
      restartedHarness.baseUrl,
      `/v1/habits/${created.id}/completions`,
      { workspaceId },
    );
    expect(history.status).toBe(200);
    expect(await history.json()).toEqual([
      expect.objectContaining({
        id: completed.id,
        workspaceId,
        habitId: created.id,
        idempotencyKey,
      }),
    ]);
  });

  it('rejects missing authenticated context and returns credential-free failures', async () => {
    const workspaceId = randomUUID();
    const harness = await createHarness();

    const missingWorkspace = await request(harness.baseUrl, '/v1/habits');
    expect(missingWorkspace.status).toBe(401);
    expect(await missingWorkspace.json()).toMatchObject({
      status: 401,
      code: 'invalid_gateway_context',
    });

    const invalidBody = await request(harness.baseUrl, '/v1/habits', {
      method: 'POST',
      workspaceId,
      body: {
        title: 'Invalid timezone',
        timezone: 'Not/A_Timezone',
        startsOn: '2026-08-03',
        recurrence: { kind: 'daily', interval: 1 },
      },
    });
    expect(invalidBody.status).toBe(400);
    expect(await invalidBody.json()).toMatchObject({
      status: 400,
      code: 'invalid_request',
    });

    const invalidHabit = await request(
      harness.baseUrl,
      '/v1/habits/not-a-uuid/completions',
      { workspaceId },
    );
    expect(invalidHabit.status).toBe(400);
    expect(await invalidHabit.json()).toMatchObject({
      status: 400,
      code: 'invalid_habit',
    });

    await harness.app.get<HabitRuntime>(HABIT_RUNTIME).close();
    const unavailable = await request(harness.baseUrl, '/v1/habits', {
      workspaceId,
    });
    expect(unavailable.status).toBe(503);
    const unavailableBody = await unavailable.json();
    expect(unavailableBody).toMatchObject({
      status: 503,
      code: 'persistence_unavailable',
    });
    const serialized = JSON.stringify(unavailableBody);
    expect(serialized).not.toContain('postgres');
    expect(serialized).not.toContain('life_os_test');
    expect(serialized).not.toContain('127.0.0.1');
  });
});
