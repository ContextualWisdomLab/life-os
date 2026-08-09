import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  createPlanningRuntime,
  type PlanningRuntime,
} from '../src/planning-runtime';

const DATABASE_URL = process.env.PLANNING_DATABASE_URL;
const TEMPORARY_DATABASE_NAME = 'life_os_today_lock_test';
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error('PLANNING_DATABASE_URL is required for PostgreSQL integration tests');
  }
  return DATABASE_URL;
}

function databaseUrl(sourceUrl: string, name: string): string {
  const parsed = new URL(sourceUrl);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function applyPlanningMigrations(pool: Pool): Promise<void> {
  for (const migrationFile of [
    '0001_initial_planning.sql',
    '0002_durable_repository_contract.sql',
    '0003_durable_today_sync.sql',
  ]) {
    const sql = await readFile(
      resolve(__dirname, '../migrations', migrationFile),
      'utf8',
    );
    await pool.query(sql);
  }
}

function draft(date: string) {
  return {
    version: 'life-os.today.v1' as const,
    date,
    actions: [],
  };
}

describeWithDatabase('PostgreSQL Today lock ordering', () => {
  it('serializes repeated identical concurrent creates into one mutation and one replay', async () => {
    const sourceUrl = requireDatabaseUrl();
    const adminPool = new Pool({
      connectionString: databaseUrl(sourceUrl, 'postgres'),
    });
    let migrationPool: Pool | undefined;
    let runtime: PlanningRuntime | undefined;
    let primaryFailure: unknown;

    try {
      await adminPool.query(
        'DROP DATABASE IF EXISTS life_os_today_lock_test WITH (FORCE)',
      );
      await adminPool.query('CREATE DATABASE life_os_today_lock_test');
      const temporaryUrl = databaseUrl(sourceUrl, TEMPORARY_DATABASE_NAME);
      migrationPool = new Pool({ connectionString: temporaryUrl });
      await applyPlanningMigrations(migrationPool);
      runtime = createPlanningRuntime({
        PLANNING_DATABASE_URL: temporaryUrl,
        PLANNING_DATABASE_POOL_MAX: '4',
        PLANNING_DATABASE_CONNECT_TIMEOUT_MS: '5000',
        PLANNING_DATABASE_IDLE_TIMEOUT_MS: '1000',
      });

      for (let iteration = 0; iteration < 12; iteration += 1) {
        const workspaceId = randomUUID();
        const idempotencyKey = randomUUID();
        const date = '2026-08-09';
        const sameDraft = draft(date);

        const outcomes = await Promise.all([
          runtime.todayService.putToday(
            workspaceId,
            sameDraft,
            { kind: 'absent' },
            idempotencyKey,
          ),
          runtime.todayService.putToday(
            workspaceId,
            sameDraft,
            { kind: 'absent' },
            idempotencyKey,
          ),
        ]);
        const kinds = outcomes.map((outcome) => outcome.kind).sort();

        expect(kinds).toEqual(['created', 'replayed']);
        expect(outcomes[0]?.aggregate).toEqual(outcomes[1]?.aggregate);
      }
    } catch (error) {
      primaryFailure = error;
      throw error;
    } finally {
      const cleanupFailures: unknown[] = [];
      const cleanups: Array<() => Promise<unknown>> = [
        async () => await runtime?.close(),
        async () => await migrationPool?.end(),
        async () =>
          await adminPool.query('DROP DATABASE IF EXISTS life_os_today_lock_test'),
        async () => await adminPool.end(),
      ];
      for (const cleanup of cleanups) {
        try {
          await cleanup();
        } catch (error) {
          cleanupFailures.push(error);
        }
      }
      if (cleanupFailures.length > 0) {
        const cleanupError = new AggregateError(
          cleanupFailures,
          'Today lock test cleanup failed',
        );
        if (primaryFailure instanceof Error) {
          if (primaryFailure.cause === undefined) {
            Object.defineProperty(primaryFailure, 'cause', {
              configurable: true,
              value: cleanupError,
            });
          }
        } else if (primaryFailure === undefined) {
          throw cleanupError;
        }
      }
    }
  }, 30_000);
});
