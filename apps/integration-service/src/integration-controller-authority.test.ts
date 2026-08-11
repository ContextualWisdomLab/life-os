import { createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  requireTrustedEventWorkspaceContext,
  type IntegrationTrustedRequestBinding,
} from './main';

const WORKSPACE_ID = '3b237d04-e84c-4ac4-933d-7f179865e1a0';
const OTHER_WORKSPACE_ID = '474c83ae-08af-4a63-957b-49eb2093a61d';
const GATEWAY_SECRET = randomBytes(32).toString('base64url');
const NOW_SECONDS = 1_786_334_400;
const EVENT_BINDING = {
  method: 'POST',
  path: '/v1/events/prepare',
} as const;
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function signContext(
  workspaceId: string,
  issuedAt: string,
  binding: Readonly<{ method: string; path: string }> = EVENT_BINDING,
): string {
  return createHmac('sha256', GATEWAY_SECRET)
    .update(
      `life-os.integration-event-context.v2\n${workspaceId.toLowerCase()}\n${issuedAt}\n${binding.method}\n${binding.path}`,
      'utf8',
    )
    .digest('base64url');
}

function responseOf(error: HttpException): unknown {
  return error.getResponse();
}

function expectContextProblem(
  operation: () => unknown,
  expected: { readonly status: number; readonly code: string },
): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  if (thrown === undefined) {
    throw new Error('Expected trusted Integration context to be rejected');
  }
  expect(thrown).toBeInstanceOf(HttpException);
  expect(responseOf(thrown as HttpException)).toMatchObject(expected);
}

describe('Integration event tenant authority contract', () => {
  it('accepts only a fresh signature bound to the exact event route', () => {
    const issuedAt = String(NOW_SECONDS);
    expect(
      requireTrustedEventWorkspaceContext(
        {
          workspaceId: WORKSPACE_ID.toUpperCase(),
          issuedAt,
          signature: signContext(WORKSPACE_ID, issuedAt),
        },
        GATEWAY_SECRET,
        EVENT_BINDING,
        NOW_SECONDS,
      ),
    ).toBe(WORKSPACE_ID);
  });

  it('rejects the legacy workspace-only signature contract', () => {
    const issuedAt = String(NOW_SECONDS);
    const legacySignature = createHmac('sha256', GATEWAY_SECRET)
      .update(`life-os.workspace.v1\n${WORKSPACE_ID}\n${issuedAt}`, 'utf8')
      .digest('base64url');

    expectContextProblem(
      () =>
        requireTrustedEventWorkspaceContext(
          { workspaceId: WORKSPACE_ID, issuedAt, signature: legacySignature },
          GATEWAY_SECRET,
          EVENT_BINDING,
          NOW_SECONDS,
        ),
      { status: 401, code: 'invalid_gateway_context' },
    );
  });

  it.each([
    {
      name: 'different path',
      binding: { method: 'POST', path: '/v1/plugins/install' },
    },
    {
      name: 'different method',
      binding: { method: 'GET', path: '/v1/events/prepare' },
    },
    {
      name: 'query string',
      binding: { method: 'POST', path: '/v1/events/prepare?dryRun=true' },
    },
    {
      name: 'fragment',
      binding: { method: 'POST', path: '/v1/events/prepare#replay' },
    },
  ])('rejects unsupported request binding: $name', ({ binding }) => {
    const issuedAt = String(NOW_SECONDS);
    expectContextProblem(
      () =>
        requireTrustedEventWorkspaceContext(
          {
            workspaceId: WORKSPACE_ID,
            issuedAt,
            signature: signContext(WORKSPACE_ID, issuedAt, binding),
          },
          GATEWAY_SECRET,
          binding satisfies IntegrationTrustedRequestBinding,
          NOW_SECONDS,
        ),
      { status: 401, code: 'invalid_gateway_context' },
    );
  });

  it('rejects a signature that was issued for another workspace', () => {
    const issuedAt = String(NOW_SECONDS);
    expectContextProblem(
      () =>
        requireTrustedEventWorkspaceContext(
          {
            workspaceId: WORKSPACE_ID,
            issuedAt,
            signature: signContext(OTHER_WORKSPACE_ID, issuedAt),
          },
          GATEWAY_SECRET,
          EVENT_BINDING,
          NOW_SECONDS,
        ),
      { status: 401, code: 'invalid_gateway_context' },
    );
  });

  it('rejects a non-canonical base64url alias for the same signature bytes', () => {
    const issuedAt = String(NOW_SECONDS);
    const canonical = signContext(WORKSPACE_ID, issuedAt);
    const finalIndex = BASE64URL_ALPHABET.indexOf(canonical.at(-1) ?? '');
    expect(finalIndex).toBeGreaterThanOrEqual(0);
    expect(finalIndex % 4).toBe(0);
    const aliasCharacter = BASE64URL_ALPHABET[finalIndex + 1];
    expect(aliasCharacter).toBeDefined();
    const nonCanonical = `${canonical.slice(0, -1)}${aliasCharacter}`;
    expect(Buffer.from(nonCanonical, 'base64url')).toEqual(
      Buffer.from(canonical, 'base64url'),
    );

    expectContextProblem(
      () =>
        requireTrustedEventWorkspaceContext(
          { workspaceId: WORKSPACE_ID, issuedAt, signature: nonCanonical },
          GATEWAY_SECRET,
          EVENT_BINDING,
          NOW_SECONDS,
        ),
      { status: 401, code: 'invalid_gateway_context' },
    );
  });

  it.each([
    {
      name: 'stale timestamp',
      issuedAt: String(NOW_SECONDS - 61),
      nowSeconds: NOW_SECONDS,
      secret: GATEWAY_SECRET,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'future timestamp',
      issuedAt: String(NOW_SECONDS + 6),
      nowSeconds: NOW_SECONDS,
      secret: GATEWAY_SECRET,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'short verifier secret',
      issuedAt: String(NOW_SECONDS),
      nowSeconds: NOW_SECONDS,
      secret: 'too-short',
      status: 503,
      code: 'gateway_context_unavailable',
    },
    {
      name: 'invalid server clock',
      issuedAt: String(NOW_SECONDS),
      nowSeconds: -1,
      secret: GATEWAY_SECRET,
      status: 503,
      code: 'gateway_context_unavailable',
    },
  ])('fails closed for $name', ({ issuedAt, nowSeconds, secret, status, code }) => {
    expectContextProblem(
      () =>
        requireTrustedEventWorkspaceContext(
          {
            workspaceId: WORKSPACE_ID,
            issuedAt,
            signature: signContext(WORKSPACE_ID, issuedAt),
          },
          secret,
          EVENT_BINDING,
          nowSeconds,
        ),
      { status, code },
    );
  });
});
