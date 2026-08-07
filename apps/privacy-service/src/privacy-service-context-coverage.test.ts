import { describe, expect, it } from 'vitest';
import {
  PrivacyServiceContextError,
  createPrivacyServiceContextHeaders,
  parsePrivacyServiceContextKeyRing,
  verifyPrivacyServiceContext,
} from './privacy-service-context';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = Buffer.alloc(32, 0x45).toString('base64url');
const ISSUED_AT = new Date('2026-08-07T09:00:00.000Z');

function ring() {
  return parsePrivacyServiceContextKeyRing({
    PRIVACY_CONTEXT_ACTIVE_KEY_ID: 'privacy-context-active',
    PRIVACY_CONTEXT_ACTIVE_KEY_SECRET: SECRET,
  });
}

function headers() {
  return createPrivacyServiceContextHeaders(
    {
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      method: 'POST',
      path: '/v1/privacy/access-decisions',
      issuedAt: ISSUED_AT,
    },
    ring(),
  );
}

describe('private context additional branch evidence', () => {
  it.each([
    null,
    42,
    [],
    {
      PRIVACY_CONTEXT_ACTIVE_KEY_ID: null,
      PRIVACY_CONTEXT_ACTIVE_KEY_SECRET: SECRET,
    },
    {
      PRIVACY_CONTEXT_ACTIVE_KEY_ID: 'active',
      PRIVACY_CONTEXT_ACTIVE_KEY_SECRET: `x\n${'y'.repeat(40)}`,
    },
    {
      PRIVACY_CONTEXT_ACTIVE_KEY_ID: 'active',
      PRIVACY_CONTEXT_ACTIVE_KEY_SECRET: 'x'.repeat(4_097),
    },
  ])('rejects additional key environments %#', (environment) => {
    expect(() => parsePrivacyServiceContextKeyRing(environment as never)).toThrow(
      PrivacyServiceContextError,
    );
  });

  it.each([
    null,
    { active: { keyId: 'active', secret: 'short' } },
  ])('rejects malformed signing key rings %#', (keyRing) => {
    expect(() =>
      createPrivacyServiceContextHeaders(
        {
          workspaceId: WORKSPACE_ID,
          actorId: ACTOR_ID,
          method: 'POST',
          path: '/v1/privacy/access-decisions',
          issuedAt: ISSUED_AT,
        },
        keyRing as never,
      ),
    ).toThrow(PrivacyServiceContextError);
  });

  it('rejects non-second issuance precision and supports exact age boundaries', () => {
    expect(() =>
      createPrivacyServiceContextHeaders(
        {
          workspaceId: WORKSPACE_ID,
          actorId: ACTOR_ID,
          method: 'POST',
          path: '/v1/privacy/access-decisions',
          issuedAt: new Date('2026-08-07T09:00:00.001Z'),
        },
        ring(),
      ),
    ).toThrow(PrivacyServiceContextError);
    expect(
      verifyPrivacyServiceContext(
        headers(),
        ring(),
        'post',
        '/v1/privacy/access-decisions',
        new Date('2026-08-07T09:01:00.999Z'),
      ),
    ).toEqual({ workspaceId: WORKSPACE_ID, actorId: ACTOR_ID });
    expect(
      verifyPrivacyServiceContext(
        headers(),
        ring(),
        'POST',
        '/v1/privacy/access-decisions',
        new Date('2026-08-07T08:59:00.000Z'),
      ),
    ).toEqual({ workspaceId: WORKSPACE_ID, actorId: ACTOR_ID });
  });

  it.each([
    null,
    [],
    42,
  ])('rejects non-record header input %#', (value) => {
    expect(() =>
      verifyPrivacyServiceContext(
        value as never,
        ring(),
        'POST',
        '/v1/privacy/access-decisions',
        ISSUED_AT,
      ),
    ).toThrow(PrivacyServiceContextError);
  });

  it('rejects duplicate case-insensitive names, invalid now, and signature length', () => {
    const valid = headers();
    const duplicate = {
      ...valid,
      'X-LIFE-OS-CONTEXT-KEY-ID': valid['x-life-os-context-key-id'],
    };
    for (const [candidate, now] of [
      [duplicate, ISSUED_AT],
      [valid, new Date(Number.NaN)],
      [
        { ...valid, 'x-life-os-context-signature': 'a'.repeat(10) },
        ISSUED_AT,
      ],
    ] as const) {
      expect(() =>
        verifyPrivacyServiceContext(
          candidate,
          ring(),
          'POST',
          '/v1/privacy/access-decisions',
          now,
        ),
      ).toThrow(PrivacyServiceContextError);
    }
  });

  it('rejects invalid verification methods and paths before signature comparison', () => {
    for (const [method, path] of [
      ['TRACE', '/v1/privacy/access-decisions'],
      ['POST', 'relative'],
      ['POST', '/v1/privacy/access-decisions#fragment'],
    ]) {
      expect(() =>
        verifyPrivacyServiceContext(
          headers(),
          ring(),
          method,
          path,
          ISSUED_AT,
        ),
      ).toThrow(PrivacyServiceContextError);
    }
  });
});
