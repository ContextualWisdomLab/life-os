import { createHmac } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { requireTrustedWorkspaceContext } from './http-boundary';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const GATEWAY_SECRET = 'trusted-gateway-context-secret-32-bytes';
const NOW_SECONDS = 1_785_806_400;
const SEARCH_BINDING = { method: 'GET', path: '/v1/search' } as const;
const GOAL_CREATE_BINDING = { method: 'POST', path: '/v1/goals' } as const;

function signContext(
  binding: Readonly<{ method: string; path: string }>,
): string {
  return createHmac('sha256', GATEWAY_SECRET)
    .update(
      `life-os.planning-context.v2\n${WORKSPACE_ID}\n${NOW_SECONDS}\n${binding.method}\n${binding.path}`,
      'utf8',
    )
    .digest('base64url');
}

function expectInvalid(operation: () => unknown): void {
  try {
    operation();
    throw new Error('Expected request-bound context to be rejected');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(401);
    expect((error as HttpException).getResponse()).toEqual({
      type: 'about:blank',
      title: 'Trusted gateway context is invalid',
      status: 401,
      code: 'invalid_gateway_context',
    });
  }
}

describe('planning request-bound workspace authority', () => {
  it('accepts a signature only for the exact HTTP method and resource path', () => {
    const signature = signContext(SEARCH_BINDING);

    expect(
      requireTrustedWorkspaceContext(
        {
          workspaceId: WORKSPACE_ID,
          issuedAt: String(NOW_SECONDS),
          signature,
        },
        GATEWAY_SECRET,
        SEARCH_BINDING,
        NOW_SECONDS,
      ),
    ).toBe(WORKSPACE_ID);
  });

  it('rejects replay of a read signature onto a mutating route', () => {
    const signature = signContext(SEARCH_BINDING);

    expectInvalid(() =>
      requireTrustedWorkspaceContext(
        {
          workspaceId: WORKSPACE_ID,
          issuedAt: String(NOW_SECONDS),
          signature,
        },
        GATEWAY_SECRET,
        GOAL_CREATE_BINDING,
        NOW_SECONDS,
      ),
    );
  });

  it('rejects cross-resource replay even when method and workspace match', () => {
    const signature = signContext({
      method: 'GET',
      path: '/v1/today/2026-08-10',
    });

    expectInvalid(() =>
      requireTrustedWorkspaceContext(
        {
          workspaceId: WORKSPACE_ID,
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
