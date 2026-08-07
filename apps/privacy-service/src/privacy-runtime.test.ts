import { describe, expect, it, vi } from 'vitest';
import { PrivacyAccessApplication } from './privacy-access-application';
import {
  PrivacyRuntime,
  createPrivacyPoolConfiguration,
  createPrivacyRuntime,
  type PrivacyPool,
  type PrivacyPoolFactory,
} from './privacy-runtime';

const DATABASE_URL = [
  'postgresql:',
  '',
  'privacy_test_user@postgres:5432',
  'life_os_test',
].join('/');
const GRANT_SECRET = Buffer.alloc(32, 0x71).toString('base64url');
const CONTEXT_SECRET = Buffer.alloc(32, 0x72).toString('base64url');
const AUDIT_SECRET = Buffer.alloc(32, 0x73).toString('base64url');

/** Creates one complete privacy runtime environment. */
function environment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    PRIVACY_DATABASE_URL: DATABASE_URL,
    PRIVACY_GRANT_ACTIVE_KEY_ID: 'privacy-grant-active',
    PRIVACY_GRANT_ACTIVE_KEY_SECRET: GRANT_SECRET,
    PRIVACY_CONTEXT_ACTIVE_KEY_ID: 'privacy-context-active',
    PRIVACY_CONTEXT_ACTIVE_KEY_SECRET: CONTEXT_SECRET,
    PRIVACY_AUDIT_DIGEST_KEY: AUDIT_SECRET,
    ...overrides,
  };
}

class RecordingPool implements PrivacyPool {
  readonly listeners: Array<(error: Error) => void> = [];
  readonly end = vi.fn(async () => undefined);
  readonly connect = vi.fn(async () => {
    throw new Error('not used in runtime composition test');
  });

  on(event: 'error', listener: (error: Error) => void): void {
    expect(event).toBe('error');
    this.listeners.push(listener);
  }
}

describe('privacy PostgreSQL pool configuration', () => {
  it('builds one bounded production pool configuration', () => {
    expect(createPrivacyPoolConfiguration(environment())).toEqual({
      connectionString: DATABASE_URL,
      application_name: 'life-os-privacy-service',
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
    expect(
      createPrivacyPoolConfiguration(
        environment({
          PRIVACY_DATABASE_POOL_MAX: '16',
          PRIVACY_DATABASE_CONNECT_TIMEOUT_MS: '1500',
          PRIVACY_DATABASE_IDLE_TIMEOUT_MS: '60000',
        }),
      ),
    ).toMatchObject({
      max: 16,
      connectionTimeoutMillis: 1_500,
      idleTimeoutMillis: 60_000,
    });
  });

  it.each([
    { PRIVACY_DATABASE_URL: undefined },
    { PRIVACY_DATABASE_URL: '' },
    { PRIVACY_DATABASE_URL: 'https://database.example' },
    { PRIVACY_DATABASE_URL: 'not-a-url' },
    { PRIVACY_DATABASE_POOL_MAX: '0' },
    { PRIVACY_DATABASE_POOL_MAX: '33' },
    { PRIVACY_DATABASE_POOL_MAX: '1.5' },
    { PRIVACY_DATABASE_CONNECT_TIMEOUT_MS: '99' },
    { PRIVACY_DATABASE_CONNECT_TIMEOUT_MS: '30001' },
    { PRIVACY_DATABASE_IDLE_TIMEOUT_MS: '999' },
    { PRIVACY_DATABASE_IDLE_TIMEOUT_MS: '300001' },
  ])('rejects invalid pool configuration %#', (override) => {
    expect(() => createPrivacyPoolConfiguration(environment(override))).toThrow(
      'Privacy database configuration is invalid',
    );
  });
});

describe('PrivacyRuntime', () => {
  it('composes one application, context key ring, and pool error listener', () => {
    const pool = new RecordingPool();
    const factory = vi.fn<PrivacyPoolFactory>(() => pool);
    const runtime = createPrivacyRuntime(environment(), factory);

    expect(runtime).toBeInstanceOf(PrivacyRuntime);
    expect(runtime.application).toBeInstanceOf(PrivacyAccessApplication);
    expect(runtime.contextKeyRing.active.keyId).toBe('privacy-context-active');
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({ connectionString: DATABASE_URL }),
    );
    expect(pool.listeners).toHaveLength(1);
    expect(() =>
      pool.listeners[0]?.(new Error('private pool failure')),
    ).not.toThrow();
  });

  it('shares one exactly-once shutdown operation across concurrent callers', async () => {
    const pool = new RecordingPool();
    const runtime = createPrivacyRuntime(environment(), () => pool);

    await Promise.all([
      runtime.close(),
      runtime.close(),
      runtime.onApplicationShutdown(),
    ]);
    expect(pool.end).toHaveBeenCalledTimes(1);
    await runtime.close();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('propagates one stable pool shutdown rejection to concurrent callers', async () => {
    const pool = new RecordingPool();
    pool.end.mockRejectedValueOnce(new Error('private shutdown failure'));
    const runtime = createPrivacyRuntime(environment(), () => pool);

    const results = await Promise.allSettled([
      runtime.close(),
      runtime.close(),
    ]);
    expect(results).toEqual([
      expect.objectContaining({ status: 'rejected' }),
      expect.objectContaining({ status: 'rejected' }),
    ]);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it.each([
    { PRIVACY_GRANT_ACTIVE_KEY_SECRET: 'short' },
    { PRIVACY_CONTEXT_ACTIVE_KEY_ID: '-bad' },
    { PRIVACY_AUDIT_DIGEST_KEY: 'short' },
  ])('rejects invalid protected runtime material %#', (override) => {
    const factory = vi.fn<PrivacyPoolFactory>();
    expect(() =>
      createPrivacyRuntime(environment(override), factory),
    ).toThrow();
    expect(factory).not.toHaveBeenCalled();
  });
});
