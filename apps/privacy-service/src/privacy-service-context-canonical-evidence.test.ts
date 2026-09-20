import { describe, expect, it } from 'vitest';
import {
  PrivacyServiceContextError,
  createPrivacyServiceContextHeaders,
  parsePrivacyServiceContextKeyRing,
  verifyPrivacyServiceContext,
} from './privacy-service-context';

const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ISSUED_AT = new Date('2026-08-07T05:00:00.000Z');
const NOW = new Date('2026-08-07T05:00:30.000Z');
const ACTIVE_SECRET = Buffer.alloc(32, 0x61).toString('base64url');
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function keyRing() {
  return parsePrivacyServiceContextKeyRing({
    PRIVACY_CONTEXT_ACTIVE_KEY_ID: 'privacy-context-2026-08-a',
    PRIVACY_CONTEXT_ACTIVE_KEY_SECRET: ACTIVE_SECRET,
  });
}

function signedHeaders() {
  return createPrivacyServiceContextHeaders(
    {
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      method: 'POST',
      path: '/v1/privacy/access-decisions',
      issuedAt: ISSUED_AT,
    },
    keyRing(),
  );
}

function nonCanonicalSignatureAlias(value: string): string {
  const finalCharacter = value.at(-1);
  if (finalCharacter === undefined) {
    throw new Error('Expected a non-empty signature');
  }
  const canonicalIndex = BASE64URL_ALPHABET.indexOf(finalCharacter);
  if (canonicalIndex < 0 || canonicalIndex % 4 !== 0) {
    throw new Error('Expected canonical unpadded SHA-256 base64url evidence');
  }
  return `${value.slice(0, -1)}${BASE64URL_ALPHABET[canonicalIndex + 1]}`;
}

describe('privacy signed-context canonical evidence', () => {
  it('rejects a case-changed workspace identifier without re-signing', () => {
    const headers = signedHeaders();
    const changed = {
      ...headers,
      'x-life-os-workspace-id': WORKSPACE_ID.toUpperCase(),
    };

    expect(() =>
      verifyPrivacyServiceContext(
        changed,
        keyRing(),
        'POST',
        '/v1/privacy/access-decisions',
        NOW,
      ),
    ).toThrow(PrivacyServiceContextError);
  });

  it('rejects whitespace-added actor evidence without re-signing', () => {
    const headers = signedHeaders();
    const changed = {
      ...headers,
      'x-life-os-actor-id': ` ${ACTOR_ID} `,
    };

    expect(() =>
      verifyPrivacyServiceContext(
        changed,
        keyRing(),
        'POST',
        '/v1/privacy/access-decisions',
        NOW,
      ),
    ).toThrow(PrivacyServiceContextError);
  });

  it('rejects a byte-equivalent noncanonical base64url signature alias', () => {
    const headers = signedHeaders();
    const signature = headers['x-life-os-context-signature'];
    const aliasedSignature = nonCanonicalSignatureAlias(signature);

    expect(aliasedSignature).not.toBe(signature);
    expect(Buffer.from(aliasedSignature, 'base64url')).toEqual(
      Buffer.from(signature, 'base64url'),
    );

    expect(() =>
      verifyPrivacyServiceContext(
        {
          ...headers,
          'x-life-os-context-signature': aliasedSignature,
        },
        keyRing(),
        'POST',
        '/v1/privacy/access-decisions',
        NOW,
      ),
    ).toThrow(PrivacyServiceContextError);
  });
});
