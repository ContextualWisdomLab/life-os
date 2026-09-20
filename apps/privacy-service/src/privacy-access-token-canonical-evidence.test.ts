import { describe, expect, it } from 'vitest';
import {
  PrivacyAccessTokenError,
  createPrivacyAccessGrantToken,
  parsePrivacyGrantKeyRing,
  verifyPrivacyAccessGrantToken,
} from './privacy-access-token';
import {
  PRIVACY_ACCESS_POLICY_DIGEST,
  PRIVACY_ACCESS_POLICY_REVISION_ID,
  type PrivacyAccessDecision,
} from './privacy-access-domain';

const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DECISION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GRANT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SECRET = Buffer.alloc(32, 0x41).toString('base64url');
const NOW = new Date('2026-08-07T01:05:00.000Z');
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function keyRing() {
  return parsePrivacyGrantKeyRing({
    PRIVACY_GRANT_ACTIVE_KEY_ID: 'privacy-2026-08-a',
    PRIVACY_GRANT_ACTIVE_KEY_SECRET: SECRET,
  });
}

function decision(): PrivacyAccessDecision {
  return {
    decisionId: DECISION_ID,
    grantId: GRANT_ID,
    workspaceId: WORKSPACE_ID,
    actorId: ACTOR_ID,
    purpose: 'workspace_operation',
    action: 'read',
    resourceCategory: 'planning_content',
    accessMode: 'ordinary',
    outcome: 'allowed',
    policyRevisionId: PRIVACY_ACCESS_POLICY_REVISION_ID,
    policyDigest: PRIVACY_ACCESS_POLICY_DIGEST,
    requestDigest: 'a'.repeat(64),
    reasonDigest: 'b'.repeat(64),
    issuedAt: '2026-08-07T01:00:00.000Z',
    expiresAt: '2026-08-07T01:10:00.000Z',
  };
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
  return `${value.slice(0, -1)}${BASE64URL_ALPHABET.charAt(canonicalIndex + 1)}`;
}

describe('privacy access grant canonical evidence', () => {
  it('rejects a byte-equivalent noncanonical grant signature alias', () => {
    const ring = keyRing();
    const token = createPrivacyAccessGrantToken(decision(), ring);
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
    const [payload, signature] = parts as [string, string];
    const aliasedSignature = nonCanonicalSignatureAlias(signature);

    expect(aliasedSignature).not.toBe(signature);
    expect(Buffer.from(aliasedSignature, 'base64url')).toEqual(
      Buffer.from(signature, 'base64url'),
    );

    expect(() =>
      verifyPrivacyAccessGrantToken(`${payload}.${aliasedSignature}`, ring, {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        now: NOW,
      }),
    ).toThrow(PrivacyAccessTokenError);
  });
});
