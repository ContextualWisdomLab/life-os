import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AiGatewayContextError,
  requireTrustedAiContext,
  type TrustedAiContextHeaders,
} from './gateway-context';

const SECRET = '0123456789abcdef0123456789abcdef';
const NOW_SECONDS = 1_786_000_000;

/** Creates the exact versioned signature expected from the authenticated gateway. */
function signContext(
  workspaceId: string,
  actorId: string,
  issuedAt: string,
  secret = SECRET,
): string {
  return createHmac('sha256', secret)
    .update(
      `life-os.ai-context.v1\n${workspaceId.toLowerCase()}\n${actorId.toLowerCase()}\n${issuedAt}`,
      'utf8',
    )
    .digest('base64url');
}

/** Builds one complete signed header set for focused mutation by each test. */
function validHeaders(
  issuedAt = String(NOW_SECONDS),
): TrustedAiContextHeaders {
  const workspaceId = randomUUID();
  const actorId = randomUUID();
  return {
    workspaceId,
    actorId,
    issuedAt,
    signature: signContext(workspaceId, actorId, issuedAt),
  };
}

/** Requires one stable credential-free verifier failure. */
function expectFailure(
  headers: TrustedAiContextHeaders,
  failure: AiGatewayContextError['failure'],
  secret: unknown = SECRET,
  nowSeconds = NOW_SECONDS,
): void {
  try {
    requireTrustedAiContext(headers, secret, nowSeconds);
    throw new Error('Expected trusted AI context verification to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(AiGatewayContextError);
    expect(error).toMatchObject({
      name: 'AiGatewayContextError',
      failure,
      message: failure,
    });
  }
}

describe('trusted AI gateway context', () => {
  it('accepts an authentic context, canonicalizes identifiers, and freezes the result', () => {
    const issuedAt = String(Math.floor(Date.now() / 1000));
    const workspaceId = randomUUID().toUpperCase();
    const actorId = randomUUID().toUpperCase();
    const context = requireTrustedAiContext(
      {
        workspaceId,
        actorId,
        issuedAt,
        signature: signContext(workspaceId, actorId, issuedAt),
      },
      SECRET,
    );

    expect(context).toEqual({
      workspaceId: workspaceId.toLowerCase(),
      actorId: actorId.toLowerCase(),
    });
    expect(Object.isFrozen(context)).toBe(true);
  });

  it('accepts the exact age and future-skew boundaries', () => {
    for (const issuedAt of [NOW_SECONDS - 60, NOW_SECONDS + 5]) {
      const headers = validHeaders(String(issuedAt));
      expect(requireTrustedAiContext(headers, SECRET, NOW_SECONDS)).toEqual({
        workspaceId: String(headers.workspaceId),
        actorId: String(headers.actorId),
      });
    }
  });

  it('fails closed when verifier secret material is absent or too short', () => {
    const headers = validHeaders();
    expectFailure(headers, 'gateway_context_unavailable', undefined);
    expectFailure(headers, 'gateway_context_unavailable', 'short');
  });

  it('rejects every malformed header field and invalid verifier clock', () => {
    const base = validHeaders();
    const malformed: TrustedAiContextHeaders[] = [
      { ...base, workspaceId: undefined },
      { ...base, actorId: undefined },
      { ...base, issuedAt: undefined },
      { ...base, signature: undefined },
      { ...base, workspaceId: 'not-a-workspace' },
      { ...base, actorId: 'not-an-actor' },
      { ...base, issuedAt: '01' },
      { ...base, signature: 'not-a-signature' },
    ];
    for (const headers of malformed) {
      expectFailure(headers, 'invalid_gateway_context');
    }
    expectFailure(base, 'invalid_gateway_context', SECRET, -1);
    expectFailure(base, 'invalid_gateway_context', SECRET, NOW_SECONDS + 0.5);
  });

  it('rejects stale and excessively future-dated authentic contexts', () => {
    expectFailure(
      validHeaders(String(NOW_SECONDS - 61)),
      'invalid_gateway_context',
    );
    expectFailure(
      validHeaders(String(NOW_SECONDS + 6)),
      'invalid_gateway_context',
    );
  });

  it('binds the signature to workspace, actor, and issuance time', () => {
    const base = validHeaders();
    const otherWorkspaceId = randomUUID();
    const otherActorId = randomUUID();
    const otherIssuedAt = String(NOW_SECONDS - 1);

    expectFailure(
      { ...base, workspaceId: otherWorkspaceId },
      'invalid_gateway_context',
    );
    expectFailure(
      { ...base, actorId: otherActorId },
      'invalid_gateway_context',
    );
    expectFailure(
      { ...base, issuedAt: otherIssuedAt },
      'invalid_gateway_context',
    );
    const signature = String(base.signature);
    const replacement = signature.endsWith('A') ? 'B' : 'A';
    expectFailure(
      { ...base, signature: `${signature.slice(0, -1)}${replacement}` },
      'invalid_gateway_context',
    );
  });
});
