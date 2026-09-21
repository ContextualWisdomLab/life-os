import { createHmac } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { requireTrustedEventWorkspaceContext } from './main';

const WORKSPACE_ID = '3b237d04-e84c-4ac4-933d-7f179865e1a0';
const SECRET = Buffer.alloc(32, 0x49).toString('base64url');
const NOW_SECONDS = 1_790_000_000;
const EVENT_BINDING = { method: 'POST', path: '/v1/events/prepare' } as const;

function signWorkspaceContext(workspaceId: string): string {
  return createHmac('sha256', SECRET)
    .update(
      `life-os.integration-event-context.v2\n${workspaceId}\n${NOW_SECONDS}\n${EVENT_BINDING.method}\n${EVENT_BINDING.path}`,
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
    throw new Error('Expected signed Integration event workspace evidence to be rejected');
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

describe('Integration event signed workspace canonicality', () => {
  it('rejects a byte-different workspace case alias without re-signing', () => {
    const signature = signWorkspaceContext(WORKSPACE_ID);
    const alteredWorkspaceId = WORKSPACE_ID.toUpperCase();

    expect(alteredWorkspaceId).not.toBe(WORKSPACE_ID);
    expectInvalid(() =>
      requireTrustedEventWorkspaceContext(
        {
          workspaceId: alteredWorkspaceId,
          issuedAt: String(NOW_SECONDS),
          signature,
        },
        SECRET,
        EVENT_BINDING,
        NOW_SECONDS,
      ),
    );
  });
});
