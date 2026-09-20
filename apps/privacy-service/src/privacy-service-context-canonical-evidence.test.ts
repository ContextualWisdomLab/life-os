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
});
