import { createHmac } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { requireTrustedWorkspaceContext } from './http-boundary';

const WORKSPACE_ID = '3b237d04-e84c-4ac4-933d-7f179865e1a0';
const GATEWAY_SECRET = Buffer.alloc(32, 0x51).toString('base64url');
const NOW_SECONDS = 1_795_000_000;
const SEARCH_BINDING = { method: 'GET', path: '/v1/search' } as const;

function signWorkspaceContext(workspaceId: string): string {
  return createHmac('sha256', GATEWAY_SECRET)
    .update(
      `life-os.planning-context.v2\n${workspaceId}\n${NOW_SECONDS}\n${SEARCH_BINDING.method}\n${SEARCH_BINDING.path}`,
      'utf8',
    )
    .digest('base64url');
}

function expectInvalid(operation: () => unknown): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  if (thrown === undefined) {
    throw new Error(
      'Expected signed Planning workspace evidence to be rejected',
    );
  }
  expect(thrown).toBeInstanceOf(HttpException);
  expect((thrown as HttpException).getStatus()).toBe(401);
  expect((thrown as HttpException).getResponse()).toEqual({
    type: 'about:blank',
    title: 'Trusted gateway context is invalid',
    status: 401,
    code: 'invalid_gateway_context',
  });
}

describe('Planning signed workspace canonical evidence', () => {
  it('rejects a case-changed workspace identifier without re-signing', () => {
    const signature = signWorkspaceContext(WORKSPACE_ID);
    const changedWorkspaceId = WORKSPACE_ID.toUpperCase();

    expect(changedWorkspaceId).not.toBe(WORKSPACE_ID);
    expectInvalid(() =>
      requireTrustedWorkspaceContext(
        {
          workspaceId: changedWorkspaceId,
          issuedAt: String(NOW_SECONDS),
          signature,
        },
        GATEWAY_SECRET,
        SEARCH_BINDING,
        NOW_SECONDS,
      ),
    );
  });
});
