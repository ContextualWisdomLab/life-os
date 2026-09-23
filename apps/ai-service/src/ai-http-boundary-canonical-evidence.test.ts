import { createHmac } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  requireTrustedAiContext,
  type TrustedAiContextHeaders,
} from './ai-http-boundary';

const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_ID = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';
const ACTIVE_KEY_ID = 'gateway-2026-09-a';
const ACTIVE_SECRET = Buffer.alloc(32, 0x41).toString('base64url');
const NOW_SECONDS = 1_790_000_000;

/** Creates the exact signer-issued AI service context for the canonical identity bytes. */
function signedContext(): TrustedAiContextHeaders {
  const issuedAt = String(NOW_SECONDS);
  const signature = createHmac('sha256', ACTIVE_SECRET)
    .update(
      `life-os.ai-context.v2\n${ACTIVE_KEY_ID}\n${WORKSPACE_ID}\n${ACTOR_ID}\n${issuedAt}\nPOST\n/v1/proposals`,
      'utf8',
    )
    .digest('base64url');
  return {
    keyId: ACTIVE_KEY_ID,
    workspaceId: WORKSPACE_ID,
    actorId: ACTOR_ID,
    issuedAt,
    signature,
  };
}

/** Requires altered signer-issued identity evidence to fail with the bounded auth problem. */
function expectInvalidContext(headers: TrustedAiContextHeaders): void {
  try {
    requireTrustedAiContext(
      headers,
      {
        AI_GATEWAY_ACTIVE_KEY_ID: ACTIVE_KEY_ID,
        AI_GATEWAY_ACTIVE_KEY_SECRET: ACTIVE_SECRET,
      },
      'POST',
      '/v1/proposals',
      NOW_SECONDS,
    );
    throw new Error('Expected altered AI context evidence to fail closed');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const exception = error as HttpException;
    expect(exception.getStatus()).toBe(401);
    expect(exception.getResponse()).toEqual({
      type: 'about:blank',
      title: 'Trusted gateway context is invalid',
      status: 401,
      code: 'invalid_gateway_context',
    });
  }
}

describe('AI signed identity evidence canonicality', () => {
  it.each([
    ['workspaceId', WORKSPACE_ID.toUpperCase()],
    ['actorId', ACTOR_ID.toUpperCase()],
  ] as const)(
    'rejects a byte-different %s case alias without a new signature',
    (field, alteredValue) => {
      const canonical = signedContext();
      expect(alteredValue).not.toBe(canonical[field]);
      expectInvalidContext({ ...canonical, [field]: alteredValue });
    },
  );
});
