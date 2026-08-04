import { createHmac } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  requireTrustedAiContext,
  type TrustedAiContextHeaders,
} from './ai-http-boundary';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const PROPOSAL_ID = '33333333-3333-4333-8333-333333333333';
const ACTIVE_KEY_ID = 'gateway-2026-08-a';
const PREVIOUS_KEY_ID = 'gateway-2026-07-z';
const ACTIVE_SECRET = Buffer.alloc(32, 0x41).toString('base64url');
const PREVIOUS_SECRET = Buffer.alloc(32, 0x42).toString('base64url');
const NOW_SECONDS = 1_785_806_400;

/** Returns one complete active-only verifier environment. */
function activeEnvironment(): {
  AI_GATEWAY_ACTIVE_KEY_ID: string;
  AI_GATEWAY_ACTIVE_KEY_SECRET: string;
} {
  return {
    AI_GATEWAY_ACTIVE_KEY_ID: ACTIVE_KEY_ID,
    AI_GATEWAY_ACTIVE_KEY_SECRET: ACTIVE_SECRET,
  };
}

/** Returns one active/previous overlap verifier environment. */
function overlapEnvironment(): {
  AI_GATEWAY_ACTIVE_KEY_ID: string;
  AI_GATEWAY_ACTIVE_KEY_SECRET: string;
  AI_GATEWAY_PREVIOUS_KEY_ID: string;
  AI_GATEWAY_PREVIOUS_KEY_SECRET: string;
} {
  return {
    ...activeEnvironment(),
    AI_GATEWAY_PREVIOUS_KEY_ID: PREVIOUS_KEY_ID,
    AI_GATEWAY_PREVIOUS_KEY_SECRET: PREVIOUS_SECRET,
  };
}

/** Creates the exact versioned HMAC expected by the AI service boundary. */
function signContext(
  input: {
    keyId?: string;
    workspaceId?: string;
    actorId?: string;
    issuedAt?: string;
    method?: string;
    path?: string;
    secret?: string;
  } = {},
): string {
  const keyId = input.keyId ?? ACTIVE_KEY_ID;
  const workspaceId = (input.workspaceId ?? WORKSPACE_ID).toLowerCase();
  const actorId = (input.actorId ?? ACTOR_ID).toLowerCase();
  const issuedAt = input.issuedAt ?? String(NOW_SECONDS);
  const method = input.method ?? 'POST';
  const path = input.path ?? '/v1/proposals';
  const secret = input.secret ?? ACTIVE_SECRET;
  return createHmac('sha256', secret)
    .update(
      `life-os.ai-context.v2\n${keyId}\n${workspaceId}\n${actorId}\n${issuedAt}\n${method}\n${path}`,
      'utf8',
    )
    .digest('base64url');
}

/** Returns one complete context header object with optional field overrides. */
function contextHeaders(
  overrides: Partial<TrustedAiContextHeaders> = {},
): TrustedAiContextHeaders {
  return {
    keyId: ACTIVE_KEY_ID,
    workspaceId: WORKSPACE_ID,
    actorId: ACTOR_ID,
    issuedAt: String(NOW_SECONDS),
    signature: signContext(),
    ...overrides,
  };
}

/** Asserts one stable credential-free problem response. */
function expectProblem(
  operation: () => unknown,
  expected: { status: number; title: string; code: string },
): void {
  try {
    operation();
    throw new Error('Expected trusted AI context validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const exception = error as HttpException;
    expect(exception.getStatus()).toBe(expected.status);
    expect(exception.getResponse()).toEqual({
      type: 'about:blank',
      ...expected,
    });
  }
}

describe('trusted AI service context', () => {
  it('accepts an exact active-key method-and-path-bound context', () => {
    expect(
      requireTrustedAiContext(
        contextHeaders({
          workspaceId: WORKSPACE_ID.toUpperCase(),
          actorId: ACTOR_ID.toUpperCase(),
        }),
        activeEnvironment(),
        'POST',
        '/v1/proposals',
        NOW_SECONDS,
      ),
    ).toEqual({ workspaceId: WORKSPACE_ID, actorId: ACTOR_ID });
  });

  it('accepts the explicitly identified previous key during overlap', () => {
    expect(
      requireTrustedAiContext(
        contextHeaders({
          keyId: PREVIOUS_KEY_ID,
          signature: signContext({
            keyId: PREVIOUS_KEY_ID,
            secret: PREVIOUS_SECRET,
          }),
        }),
        overlapEnvironment(),
        'POST',
        '/v1/proposals',
        NOW_SECONDS,
      ),
    ).toEqual({ workspaceId: WORKSPACE_ID, actorId: ACTOR_ID });
  });

  it('accepts proposal and decision paths at documented time boundaries', () => {
    for (const input of [
      {
        issuedAt: NOW_SECONDS - 60,
        method: 'GET',
        path: `/v1/proposals/${PROPOSAL_ID}`,
      },
      {
        issuedAt: NOW_SECONDS + 5,
        method: 'POST',
        path: `/v1/proposals/${PROPOSAL_ID}/decisions`,
      },
    ] as const) {
      const issuedAt = String(input.issuedAt);
      expect(
        requireTrustedAiContext(
          contextHeaders({
            issuedAt,
            signature: signContext({
              issuedAt,
              method: input.method,
              path: input.path,
            }),
          }),
          activeEnvironment(),
          input.method,
          input.path,
          NOW_SECONDS,
        ),
      ).toEqual({ workspaceId: WORKSPACE_ID, actorId: ACTOR_ID });
    }
  });

  it.each([
    {},
    { AI_GATEWAY_ACTIVE_KEY_ID: ACTIVE_KEY_ID },
    { AI_GATEWAY_ACTIVE_KEY_SECRET: ACTIVE_SECRET },
    {
      ...activeEnvironment(),
      AI_GATEWAY_PREVIOUS_KEY_ID: PREVIOUS_KEY_ID,
    },
    {
      ...activeEnvironment(),
      AI_GATEWAY_PREVIOUS_KEY_SECRET: PREVIOUS_SECRET,
    },
    {
      ...activeEnvironment(),
      AI_GATEWAY_PREVIOUS_KEY_ID: ACTIVE_KEY_ID,
      AI_GATEWAY_PREVIOUS_KEY_SECRET: PREVIOUS_SECRET,
    },
    {
      ...activeEnvironment(),
      AI_GATEWAY_PREVIOUS_KEY_ID: PREVIOUS_KEY_ID,
      AI_GATEWAY_PREVIOUS_KEY_SECRET: ACTIVE_SECRET,
    },
  ])('fails closed when gateway key configuration is unavailable: %#', (keys) => {
    expectProblem(
      () =>
        requireTrustedAiContext(
          contextHeaders(),
          keys,
          'POST',
          '/v1/proposals',
          NOW_SECONDS,
        ),
      {
        title: 'Trusted gateway context is unavailable',
        status: 503,
        code: 'gateway_context_unavailable',
      },
    );
  });

  it.each([
    { field: 'keyId', value: undefined },
    { field: 'keyId', value: null },
    { field: 'keyId', value: '' },
    { field: 'keyId', value: '-leading' },
    { field: 'keyId', value: 'unknown-key' },
    { field: 'workspaceId', value: undefined },
    { field: 'workspaceId', value: 'workspace-a' },
    { field: 'actorId', value: null },
    { field: 'actorId', value: 'actor-a' },
    { field: 'issuedAt', value: `0${NOW_SECONDS}` },
    { field: 'issuedAt', value: 'not-a-time' },
    { field: 'issuedAt', value: '12345678901234' },
    { field: 'signature', value: undefined },
    { field: 'signature', value: 'invalid' },
    { field: 'signature', value: `${'a'.repeat(42)}!` },
  ])('rejects malformed or unknown context field $field: %#', ({ field, value }) => {
    expectProblem(
      () =>
        requireTrustedAiContext(
          contextHeaders({ [field]: value }),
          overlapEnvironment(),
          'POST',
          '/v1/proposals',
          NOW_SECONDS,
        ),
      {
        title: 'Trusted gateway context is invalid',
        status: 401,
        code: 'invalid_gateway_context',
      },
    );
  });

  it('rejects the previous key immediately after retirement', () => {
    expectProblem(
      () =>
        requireTrustedAiContext(
          contextHeaders({
            keyId: PREVIOUS_KEY_ID,
            signature: signContext({
              keyId: PREVIOUS_KEY_ID,
              secret: PREVIOUS_SECRET,
            }),
          }),
          activeEnvironment(),
          'POST',
          '/v1/proposals',
          NOW_SECONDS,
        ),
      {
        title: 'Trusted gateway context is invalid',
        status: 401,
        code: 'invalid_gateway_context',
      },
    );
  });

  it.each([
    { issuedAt: NOW_SECONDS - 61, nowSeconds: NOW_SECONDS },
    { issuedAt: NOW_SECONDS + 6, nowSeconds: NOW_SECONDS },
    { issuedAt: NOW_SECONDS, nowSeconds: -1 },
    { issuedAt: NOW_SECONDS, nowSeconds: Number.MAX_SAFE_INTEGER + 1 },
  ])(
    'rejects stale, future, or invalid clock input %#',
    ({ issuedAt, nowSeconds }) => {
      const issuedAtText = String(issuedAt);
      expectProblem(
        () =>
          requireTrustedAiContext(
            contextHeaders({
              issuedAt: issuedAtText,
              signature: signContext({ issuedAt: issuedAtText }),
            }),
            activeEnvironment(),
            'POST',
            '/v1/proposals',
            nowSeconds,
          ),
        {
          title: 'Trusted gateway context is invalid',
          status: 401,
          code: 'invalid_gateway_context',
        },
      );
    },
  );

  it.each([
    { method: 'post', path: '/v1/proposals' },
    { method: 'PUT', path: '/v1/proposals' },
    { method: 42, path: '/v1/proposals' },
    { method: 'GET', path: '/v1/proposals/' },
    { method: 'GET', path: '/v1/proposals?workspace=other' },
    { method: 'GET', path: `/v1/proposals/${PROPOSAL_ID.toUpperCase()}` },
    { method: 'GET', path: '/v1/proposals/not-a-uuid' },
    { method: 'GET', path: '/v1/proposals/decisions' },
    { method: 'GET', path: '/v1/proposals\n' },
    { method: 'GET', path: 'x'.repeat(257) },
    { method: 'GET', path: 42 },
  ])('rejects noncanonical method or path %#', ({ method, path }) => {
    expectProblem(
      () =>
        requireTrustedAiContext(
          contextHeaders(),
          activeEnvironment(),
          method,
          path,
          NOW_SECONDS,
        ),
      {
        title: 'Trusted gateway context is invalid',
        status: 401,
        code: 'invalid_gateway_context',
      },
    );
  });

  it('rejects a noncanonical base64url spelling of a 32-byte signature', () => {
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const canonical = signContext();
    const finalIndex = alphabet.indexOf(canonical[canonical.length - 1]!);
    expect(finalIndex).toBeGreaterThanOrEqual(0);
    expect(finalIndex % 4).toBe(0);
    const alternateFinalCharacter = alphabet[finalIndex + 1]!;
    expect(alternateFinalCharacter).toBeDefined();
    const noncanonical = `${canonical.slice(0, -1)}${alternateFinalCharacter}`;

    expectProblem(
      () =>
        requireTrustedAiContext(
          contextHeaders({ signature: noncanonical }),
          activeEnvironment(),
          'POST',
          '/v1/proposals',
          NOW_SECONDS,
        ),
      {
        title: 'Trusted gateway context is invalid',
        status: 401,
        code: 'invalid_gateway_context',
      },
    );
  });

  it.each([
    {
      keyId: ACTIVE_KEY_ID,
      method: 'GET',
      path: '/v1/proposals',
      signature: signContext({ method: 'POST' }),
    },
    {
      keyId: ACTIVE_KEY_ID,
      method: 'POST',
      path: `/v1/proposals/${PROPOSAL_ID}`,
      signature: signContext({ method: 'POST', path: '/v1/proposals' }),
    },
    {
      keyId: ACTIVE_KEY_ID,
      method: 'POST',
      path: '/v1/proposals',
      signature: signContext({ secret: PREVIOUS_SECRET }),
    },
    {
      keyId: PREVIOUS_KEY_ID,
      method: 'POST',
      path: '/v1/proposals',
      signature: signContext({
        keyId: ACTIVE_KEY_ID,
        secret: ACTIVE_SECRET,
      }),
    },
  ])('rejects replay, forgery, or key-identifier substitution %#', (input) => {
    expectProblem(
      () =>
        requireTrustedAiContext(
          contextHeaders({
            keyId: input.keyId,
            signature: input.signature,
          }),
          overlapEnvironment(),
          input.method,
          input.path,
          NOW_SECONDS,
        ),
      {
        title: 'Trusted gateway context is invalid',
        status: 401,
        code: 'invalid_gateway_context',
      },
    );
  });
});
