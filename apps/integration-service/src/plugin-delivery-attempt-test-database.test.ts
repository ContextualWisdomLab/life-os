import { describe, expect, it } from 'vitest';
import {
  parsePluginDeliveryAttemptTestDatabaseTarget,
} from './plugin-delivery-attempt-test-database';

describe('parsePluginDeliveryAttemptTestDatabaseTarget', () => {
  it('accepts explicit local disposable PostgreSQL targets', () => {
    for (const databaseUrl of [
      'postgresql://life_os:secret@127.0.0.1:5432/life_os_integration?sslmode=disable',
      'postgresql://life_os:secret@localhost:5432/life_os_integration?sslmode=disable',
      'postgresql://life_os:secret@[::1]:5432/life_os_integration?sslmode=disable',
    ]) {
      expect(
        parsePluginDeliveryAttemptTestDatabaseTarget(databaseUrl),
      ).toMatchObject({
        port: '5432',
        username: 'life_os',
        password: 'secret',
        database: 'life_os_integration',
        sslMode: 'disable',
      });
    }
  });

  it('rejects malformed or non-PostgreSQL URLs', () => {
    for (const databaseUrl of [
      'not a URL',
      'https://life_os:secret@127.0.0.1:5432/life_os_integration?sslmode=disable',
      'postgresql://life_os%ZZ:secret@127.0.0.1:5432/life_os_integration?sslmode=disable',
    ]) {
      expect(() =>
        parsePluginDeliveryAttemptTestDatabaseTarget(databaseUrl),
      ).toThrow('dedicated Integration test database URL');
    }
  });

  it('requires one explicitly supported TLS mode instead of inheriting libpq prefer', () => {
    for (const databaseUrl of [
      'postgresql://life_os:secret@127.0.0.1:5432/life_os_integration',
      'postgresql://life_os:secret@127.0.0.1:5432/life_os_integration?sslmode=allow',
      'postgresql://life_os:secret@127.0.0.1:5432/life_os_integration?sslmode=require&sslmode=verify-full',
    ]) {
      expect(() =>
        parsePluginDeliveryAttemptTestDatabaseTarget(databaseUrl),
      ).toThrow('explicit sslmode');
    }
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

  it('preserves encrypted remote TLS modes', () => {
    for (const sslMode of ['require', 'verify-ca', 'verify-full'] as const) {
      expect(
        parsePluginDeliveryAttemptTestDatabaseTarget(
          `postgresql://life_os:secret@db.example.test:5432/life_os_integration?sslmode=${sslMode}`,
        ).sslMode,
      ).toBe(sslMode);
    }
  });
});
