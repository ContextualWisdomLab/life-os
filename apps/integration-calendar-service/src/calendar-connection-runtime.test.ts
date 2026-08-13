import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarConnectionCreateApplication } from './calendar-connection-create';
import { CalendarConnectionDisconnectApplication } from './calendar-connection-disconnect';
import { CalendarConnectionReadApplication } from './calendar-connection-read';
import {
  type CalendarConnectionPool,
  createCalendarConnectionLifecycleRuntime,
  createCalendarConnectionPoolConfiguration,
} from './calendar-connection-runtime';

const TEST_DATABASE_URL = 'postgresql://calendar.invalid/life_os_calendar';
const directories: string[] = [];

async function environment(): Promise<NodeJS.ProcessEnv> {
  const directory = await mkdtemp(join(tmpdir(), 'life-os-calendar-runtime-'));
  directories.push(directory);
  return {
    CALENDAR_CONNECTION_DATABASE_URL: TEST_DATABASE_URL,
    CALENDAR_CONNECTION_DATABASE_POOL_MAX: '7',
    CALENDAR_CONNECTION_DATABASE_CONNECT_TIMEOUT_MS: '2300',
    CALENDAR_CONNECTION_DATABASE_IDLE_TIMEOUT_MS: '17000',
    CALENDAR_SECRET_STORE_DIRECTORY: directory,
    CALENDAR_SECRET_STORE_KEY: randomBytes(32).toString('base64'),
  };
}

function pool(): CalendarConnectionPool {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    end: vi.fn(async () => undefined),
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('calendar connection lifecycle runtime', () => {
  it('builds a bounded calendar-owned PostgreSQL pool configuration', async () => {
    const runtimeEnvironment = await environment();
    expect(createCalendarConnectionPoolConfiguration(runtimeEnvironment)).toEqual({
      connectionString: TEST_DATABASE_URL,
      application_name: 'life-os-integration-calendar-service',
      max: 7,
      connectionTimeoutMillis: 2300,
      idleTimeoutMillis: 17000,
    });

    expect(() =>
      createCalendarConnectionPoolConfiguration({
        CALENDAR_CONNECTION_DATABASE_URL: 'https://calendar.invalid/database',
      }),
    ).toThrow('Calendar connection database URL must use PostgreSQL');
    expect(() =>
      createCalendarConnectionPoolConfiguration({
        CALENDAR_CONNECTION_DATABASE_URL: TEST_DATABASE_URL,
        CALENDAR_CONNECTION_DATABASE_POOL_MAX: '0',
      }),
    ).toThrow('Calendar connection database pool size is invalid');
  });

  it('composes create, read, and disconnect applications over one owned runtime', async () => {
    const runtimeEnvironment = await environment();
    const ownedPool = pool();
    const poolFactory = vi.fn(() => ownedPool);

    const runtime = createCalendarConnectionLifecycleRuntime(
      runtimeEnvironment,
      poolFactory,
    );

    expect(poolFactory).toHaveBeenCalledWith(
      createCalendarConnectionPoolConfiguration(runtimeEnvironment),
    );
    expect(runtime.createApplication).toBeInstanceOf(
      CalendarConnectionCreateApplication,
    );
    expect(runtime.readApplication).toBeInstanceOf(CalendarConnectionReadApplication);
    expect(runtime.disconnectApplication).toBeInstanceOf(
      CalendarConnectionDisconnectApplication,
    );

    await runtime.close();
    await runtime.close();
    expect(ownedPool.end).toHaveBeenCalledTimes(1);
  });
});
