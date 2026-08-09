import { describe, expect, it } from 'vitest';
import * as oauthBoundary from './oauth-http-boundary';

type RecentAuthenticationGate = (input: {
  readonly authenticatedAt: string;
  readonly now: Date;
  readonly maximumAgeMs: number;
}) => string;

function recentAuthenticationGate(): RecentAuthenticationGate {
  const candidate = (
    oauthBoundary as unknown as Readonly<Record<string, unknown>>
  ).requireRecentAuthentication;
  expect(typeof candidate).toBe('function');
  return candidate as RecentAuthenticationGate;
}

describe('data-rights recent authentication gate', () => {
  it('accepts an authentication instant at the exact maximum age boundary', () => {
    const requireRecentAuthentication = recentAuthenticationGate();

    expect(
      requireRecentAuthentication({
        authenticatedAt: '2026-08-09T17:50:00.000Z',
        now: new Date('2026-08-09T18:00:00.000Z'),
        maximumAgeMs: 10 * 60 * 1000,
      }),
    ).toBe('2026-08-09T17:50:00.000Z');
  });

  it('rejects a stale authentication instant even when the session itself is still valid', () => {
    const requireRecentAuthentication = recentAuthenticationGate();

    expect(() =>
      requireRecentAuthentication({
        authenticatedAt: '2026-08-09T17:49:59.999Z',
        now: new Date('2026-08-09T18:00:00.000Z'),
        maximumAgeMs: 10 * 60 * 1000,
      }),
    ).toThrow('Recent authentication is required');
  });

  it('fails closed on future, malformed, or invalid policy timestamps', () => {
    const requireRecentAuthentication = recentAuthenticationGate();

    expect(() =>
      requireRecentAuthentication({
        authenticatedAt: '2026-08-09T18:00:00.001Z',
        now: new Date('2026-08-09T18:00:00.000Z'),
        maximumAgeMs: 10 * 60 * 1000,
      }),
    ).toThrow('Authentication provenance is invalid');
    expect(() =>
      requireRecentAuthentication({
        authenticatedAt: 'not-an-instant',
        now: new Date('2026-08-09T18:00:00.000Z'),
        maximumAgeMs: 10 * 60 * 1000,
      }),
    ).toThrow('Authentication provenance is invalid');
    expect(() =>
      requireRecentAuthentication({
        authenticatedAt: '2026-08-09T17:55:00.000Z',
        now: new Date('invalid'),
        maximumAgeMs: 10 * 60 * 1000,
      }),
    ).toThrow('Recent authentication policy is invalid');
    expect(() =>
      requireRecentAuthentication({
        authenticatedAt: '2026-08-09T17:55:00.000Z',
        now: new Date('2026-08-09T18:00:00.000Z'),
        maximumAgeMs: 0,
      }),
    ).toThrow('Recent authentication policy is invalid');
  });
});
