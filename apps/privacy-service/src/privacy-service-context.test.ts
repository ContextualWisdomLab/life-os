import { describe, expect, it } from 'vitest';
import {
  PrivacyServiceContextError,
  createPrivacyServiceContextHeaders,
  parsePrivacyServiceContextKeyRing,
  verifyPrivacyServiceContext,
} from './privacy-service-context';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-08-07T05:00:30.000Z');
const ACTIVE_SECRET = Buffer.alloc(32, 0x61).toString('base64url');
const PREVIOUS_SECRET = Buffer.alloc(32, 0x62).toString('base64url');

/** Creates one valid active-only private-context key environment. */
function activeEnvironment() {
  return {
    PRIVACY_CONTEXT_ACTIVE_KEY_ID: 'privacy-context-2026-08-a',
    PRIVACY_CONTEXT_ACTIVE_KEY_SECRET: ACTIVE_SECRET,
  };
}

describe('privacy service context key configuration', () => {
  it('creates immutable active and optional previous verification keys', () => {
    const activeOnly = parsePrivacyServiceContextKeyRing(activeEnvironment());
    expect(activeOnly).toEqual({
      active: {
        keyId: 'privacy-context-2026-08-a',
        secret: ACTIVE_SECRET,
      },
    });
    expect(Object.isFrozen(activeOnly)).toBe(true);
    const overlap = parsePrivacyServiceContextKeyRing({
      ...activeEnvironment(),
      PRIVACY_CONTEXT_PREVIOUS_KEY_ID: 'privacy-context-2026-07-z',
      PRIVACY_CONTEXT_PREVIOUS_KEY_SECRET: PREVIOUS_SECRET,
    });
    expect(overlap.previous).toEqual({
      keyId: 'privacy-context-2026-07-z',
      secret: PREVIOUS_SECRET,
    });
  });

  it.each([
    {},
    { PRIVACY_CONTEXT_ACTIVE_KEY_ID: 'active' },
    { PRIVACY_CONTEXT_ACTIVE_KEY_SECRET: ACTIVE_SECRET },
    {
      ...activeEnvironment(),
      PRIVACY_CONTEXT_PREVIOUS_KEY_ID: 'previous',
    },
    {
      ...activeEnvironment(),
      PRIVACY_CONTEXT_PREVIOUS_KEY_SECRET: PREVIOUS_SECRET,
    },
    {
      ...activeEnvironment(),
      PRIVACY_CONTEXT_PREVIOUS_KEY_ID: 'privacy-context-2026-08-a',
      PRIVACY_CONTEXT_PREVIOUS_KEY_SECRET: PREVIOUS_SECRET,
    },
    {
      ...activeEnvironment(),
      PRIVACY_CONTEXT_PREVIOUS_KEY_ID: 'privacy-context-2026-07-z',
      PRIVACY_CONTEXT_PREVIOUS_KEY_SECRET: ACTIVE_SECRET,
    },
    {
      PRIVACY_CONTEXT_ACTIVE_KEY_ID: '-bad',
      PRIVACY_CONTEXT_ACTIVE_KEY_SECRET: ACTIVE_SECRET,
    },
    {
      PRIVACY_CONTEXT_ACTIVE_KEY_ID: 'active',
      PRIVACY_CONTEXT_ACTIVE_KEY_SECRET: 'short',
    },
  ])('rejects invalid context key configuration %#', (environment) => {
    expect(() => parsePrivacyServiceContextKeyRing(environment)).toThrow(
      PrivacyServiceContextError,
    );
  });
});

describe('signed privacy service context', () => {
  it('signs and verifies exact workspace, actor, method, path, and issuance time', () => {
    const keyRing = parsePrivacyServiceContextKeyRing(activeEnvironment());
    const headers = createPrivacyServiceContextHeaders(
      {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        method: 'post',
        path: '/v1/privacy/access-decisions',
        issuedAt: new Date('2026-08-07T05:00:00.000Z'),
      },
      keyRing,
    );
    expect(headers).toEqual({
      'x-life-os-context-key-id': 'privacy-context-2026-08-a',
      'x-life-os-workspace-id': WORKSPACE_ID,
      'x-life-os-actor-id': ACTOR_ID,
      'x-life-os-context-issued-at': '1786078800',
      'x-life-os-context-signature': expect.stringMatching(
        /^[A-Za-z0-9_-]+$/u,
      ),
    });
    expect(JSON.stringify(headers)).not.toContain(ACTIVE_SECRET);

    expect(
      verifyPrivacyServiceContext(
        headers,
        keyRing,
        'POST',
        '/v1/privacy/access-decisions',
        NOW,
      ),
    ).toEqual({ workspaceId: WORKSPACE_ID, actorId: ACTOR_ID });
  });

  it('verifies an explicitly selected previous overlap key', () => {
    const previousSigner = parsePrivacyServiceContextKeyRing({
      PRIVACY_CONTEXT_ACTIVE_KEY_ID: 'privacy-context-2026-07-z',
      PRIVACY_CONTEXT_ACTIVE_KEY_SECRET: PREVIOUS_SECRET,
    });
    const headers = createPrivacyServiceContextHeaders(
      {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        method: 'POST',
        path: '/v1/privacy/access-grants/consume',
        issuedAt: new Date('2026-08-07T05:00:00.000Z'),
      },
      previousSigner,
    );
    const overlap = parsePrivacyServiceContextKeyRing({
      ...activeEnvironment(),
      PRIVACY_CONTEXT_PREVIOUS_KEY_ID: 'privacy-context-2026-07-z',
      PRIVACY_CONTEXT_PREVIOUS_KEY_SECRET: PREVIOUS_SECRET,
    });
    expect(
      verifyPrivacyServiceContext(
        headers,
        overlap,
        'POST',
        '/v1/privacy/access-grants/consume',
        NOW,
      ),
    ).toEqual({ workspaceId: WORKSPACE_ID, actorId: ACTOR_ID });
  });

  it.each([
    { method: 'GET' },
    { path: '/v1/privacy/access-grants/consume' },
    { now: new Date('2026-08-07T05:01:01.000Z') },
    { now: new Date('2026-08-07T04:58:59.000Z') },
  ])('rejects replay across method, path, stale, or future time %#', (override) => {
    const keyRing = parsePrivacyServiceContextKeyRing(activeEnvironment());
    const headers = createPrivacyServiceContextHeaders(
      {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        method: 'POST',
        path: '/v1/privacy/access-decisions',
        issuedAt: new Date('2026-08-07T05:00:00.000Z'),
      },
      keyRing,
    );
    expect(() =>
      verifyPrivacyServiceContext(
        headers,
        keyRing,
        override.method ?? 'POST',
        override.path ?? '/v1/privacy/access-decisions',
        override.now ?? NOW,
      ),
    ).toThrow(PrivacyServiceContextError);
  });

  it('rejects altered ownership, signature, key identifier, and header shapes', () => {
    const keyRing = parsePrivacyServiceContextKeyRing(activeEnvironment());
    const headers = createPrivacyServiceContextHeaders(
      {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        method: 'POST',
        path: '/v1/privacy/access-decisions',
        issuedAt: new Date('2026-08-07T05:00:00.000Z'),
      },
      keyRing,
    );
    const cases: Array<Record<string, unknown>> = [
      { ...headers, 'x-life-os-workspace-id': 'numeric-1' },
      {
        ...headers,
        'x-life-os-actor-id':
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      { ...headers, 'x-life-os-context-signature': 'forged' },
      { ...headers, 'x-life-os-context-key-id': 'retired-key' },
      { ...headers, 'x-life-os-context-issued-at': '1.5' },
      { ...headers, extra: 'not-accepted' },
      { ...headers, 'x-life-os-context-signature': ['repeated'] },
    ];
    for (const candidate of cases) {
      expect(() =>
        verifyPrivacyServiceContext(
          candidate,
          keyRing,
          'POST',
          '/v1/privacy/access-decisions',
          NOW,
        ),
      ).toThrow(PrivacyServiceContextError);
    }
  });

  it.each([
    { workspaceId: '1' },
    { actorId: 'numeric-2' },
    { method: 'POST\nGET' },
    { method: 'TRACE' },
    { path: 'relative' },
    { path: '/v1/privacy/access-decisions?query=unsafe' },
    { issuedAt: new Date(Number.NaN) },
  ])('rejects malformed signing input %#', (override) => {
    const keyRing = parsePrivacyServiceContextKeyRing(activeEnvironment());
    expect(() =>
      createPrivacyServiceContextHeaders(
        {
          workspaceId: WORKSPACE_ID,
          actorId: ACTOR_ID,
          method: 'POST',
          path: '/v1/privacy/access-decisions',
          issuedAt: new Date('2026-08-07T05:00:00.000Z'),
          ...override,
        },
        keyRing,
      ),
    ).toThrow(PrivacyServiceContextError);
  });

  it('uses stable errors without retaining rejected signatures or key material', () => {
    const keyRing = parsePrivacyServiceContextKeyRing(activeEnvironment());
    const rejected = `private-${'x'.repeat(40)}`;
    let failure: unknown;
    try {
      verifyPrivacyServiceContext(
        {
          'x-life-os-context-key-id': 'privacy-context-2026-08-a',
          'x-life-os-workspace-id': WORKSPACE_ID,
          'x-life-os-actor-id': ACTOR_ID,
          'x-life-os-context-issued-at': '1786078800',
          'x-life-os-context-signature': rejected,
        },
        keyRing,
        'POST',
        '/v1/privacy/access-decisions',
        NOW,
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toEqual(new PrivacyServiceContextError());
    expect(String(failure)).not.toContain(rejected);
    expect(String(failure)).not.toContain(ACTIVE_SECRET);
  });
});
