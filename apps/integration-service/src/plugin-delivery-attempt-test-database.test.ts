import { describe, expect, it } from 'vitest';
import { parsePluginDeliveryAttemptTestDatabaseTarget } from './plugin-delivery-attempt-test-database';

describe('parsePluginDeliveryAttemptTestDatabaseTarget', () => {
  it('accepts the explicit local disposable PostgreSQL target', () => {
    expect(
      parsePluginDeliveryAttemptTestDatabaseTarget(
        'postgresql://life_os:secret@127.0.0.1:5432/life_os_integration?sslmode=disable',
      ),
    ).toEqual({
      hostname: '127.0.0.1',
      port: '5432',
      username: 'life_os',
      password: 'secret',
      database: 'life_os_integration',
      sslMode: 'disable',
    });
  });

  it('requires an explicit TLS mode instead of inheriting libpq prefer', () => {
    expect(() =>
      parsePluginDeliveryAttemptTestDatabaseTarget(
        'postgresql://life_os:secret@127.0.0.1:5432/life_os_integration',
      ),
    ).toThrow('explicit sslmode');
  });

  it('rejects destructive setup against an unexpected database or role', () => {
    for (const databaseUrl of [
      'postgresql://life_os:secret@127.0.0.1:5432/life_os?sslmode=disable',
      'postgresql://postgres:secret@127.0.0.1:5432/life_os_integration?sslmode=disable',
    ]) {
      expect(() =>
        parsePluginDeliveryAttemptTestDatabaseTarget(databaseUrl),
      ).toThrow('dedicated Integration test database');
    }
  });

  it('allows sslmode=disable only on loopback targets', () => {
    expect(() =>
      parsePluginDeliveryAttemptTestDatabaseTarget(
        'postgresql://life_os:secret@db.example.test:5432/life_os_integration?sslmode=disable',
      ),
    ).toThrow('loopback');
  });

  it('preserves server-verifying TLS modes for remote disposable targets', () => {
    expect(
      parsePluginDeliveryAttemptTestDatabaseTarget(
        'postgresql://life_os:secret@db.example.test:5432/life_os_integration?sslmode=verify-full',
      ).sslMode,
    ).toBe('verify-full');
  });
});
