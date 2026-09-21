import { createHmac } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { requireTrustedWorkspaceContext } from './http-boundary';

const WORKSPACE_ID = 'a0b1c2d3-e4f5-4a67-8b9c-d0e1f2a3b4c5';
const GATEWAY_SECRET = 'trusted-habit-gateway-secret-32-bytes';
const NOW_SECONDS = 1_786_291_200;

function sign(workspaceId: string, issuedAt: string): string {
  return createHmac('sha256', GATEWAY_SECRET)
    .update(`life-os.workspace.v1\n${workspaceId}\n${issuedAt}`, 'utf8')
    .digest('base64url');
}

function expectInvalidGatewayContext(operation: () => unknown): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(401);
    expect((error as HttpException).getResponse()).toMatchObject({
      status: 401,
      code: 'invalid_gateway_context',
    });
    return;
  }
  throw new Error('Expected signed workspace evidence to fail closed');
}

describe('Habit canonical signed workspace evidence', () => {
  it('rejects case-changed signer-issued workspace evidence without re-signing', () => {
    const issuedAt = String(NOW_SECONDS);
    const signature = sign(WORKSPACE_ID, issuedAt);
    const alteredWorkspaceId = WORKSPACE_ID.toUpperCase();

    expect(alteredWorkspaceId).not.toBe(WORKSPACE_ID);
    expectInvalidGatewayContext(() =>
      requireTrustedWorkspaceContext(
        {
          workspaceId: alteredWorkspaceId,
          issuedAt,
          signature,
        },
        GATEWAY_SECRET,
        NOW_SECONDS,
      ),
    );
  });
});
