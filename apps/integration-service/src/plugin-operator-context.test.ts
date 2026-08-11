import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  IntegrationOperatorContextError,
  requireTrustedPluginOperatorContext,
} from './plugin-operator-context';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';
const ISSUED_AT = '1786291200';
const SECRET = randomBytes(32).toString('base64url');
const INSTALL_PATH = '/v1/plugins/installations';

function signature(
  method = 'POST',
  path = INSTALL_PATH,
  workspaceId = WORKSPACE_ID,
  userId = USER_ID,
  issuedAt = ISSUED_AT,
): string {
  return createHmac('sha256', SECRET)
    .update(
      `life-os.integration-operator-context.v1\n${workspaceId}\n${userId}\n${issuedAt}\n${method}\n${path}`,
      'utf8',
    )
    .digest('base64url');
}

function context(
  overrides: Partial<
    Record<'workspaceId' | 'userId' | 'issuedAt' | 'signature', unknown>
  > = {},
) {
  return {
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    issuedAt: ISSUED_AT,
    signature: signature(),
    ...overrides,
  };
}

function expectInvalid(operation: () => unknown): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(IntegrationOperatorContextError);
  expect(thrown).toMatchObject({ kind: 'invalid' });
}

describe('trusted plugin operator context', () => {
  it('returns normalized workspace-user authority only for the exact signed route', () => {
    expect(
      requireTrustedPluginOperatorContext(
        context(),
        SECRET,
        { method: 'POST', path: INSTALL_PATH },
        Number(ISSUED_AT),
      ),
    ).toEqual({ workspaceId: WORKSPACE_ID, actorUserId: USER_ID });
  });

  it('rejects cross-user, cross-workspace, method, and path replay as invalid evidence', () => {
    const cases = [
      context({ userId: OTHER_USER_ID }),
      context({ workspaceId: '44444444-4444-4444-8444-444444444444' }),
      context({ signature: signature('GET', INSTALL_PATH) }),
      context({
        signature: signature('POST', '/v1/plugins/credential-bindings'),
      }),
    ];

    for (const candidate of cases) {
      expectInvalid(() =>
        requireTrustedPluginOperatorContext(
          candidate,
          SECRET,
          { method: 'POST', path: INSTALL_PATH },
          Number(ISSUED_AT),
        ),
      );
    }
  });

  it('accepts only the bounded operator route surface', () => {
    const installationId = '55555555-5555-4555-8555-555555555555';
    const bindingId = '66666666-6666-4666-8666-666666666666';
    const routes = [
      { method: 'POST', path: INSTALL_PATH },
      { method: 'GET', path: `/v1/plugins/installations/${installationId}` },
      {
        method: 'POST',
        path: `/v1/plugins/installations/${installationId}/revoke`,
      },
      { method: 'POST', path: '/v1/plugins/credential-bindings' },
      {
        method: 'POST',
        path: `/v1/plugins/credential-bindings/${bindingId}/revoke`,
      },
    ] as const;

    for (const route of routes) {
      const signed = context({
        signature: signature(route.method, route.path),
      });
      expect(
        requireTrustedPluginOperatorContext(
          signed,
          SECRET,
          route,
          Number(ISSUED_AT),
        ),
      ).toEqual({ workspaceId: WORKSPACE_ID, actorUserId: USER_ID });
    }

    const invalidRoutes = [
      { method: 'DELETE', path: INSTALL_PATH },
      { method: 'POST', path: `${INSTALL_PATH}?workspace=other` },
      { method: 'POST', path: `${INSTALL_PATH}/not-a-uuid/revoke` },
      { method: 'POST', path: `${INSTALL_PATH}/../credential-bindings` },
    ];
    for (const route of invalidRoutes) {
      expectInvalid(() =>
        requireTrustedPluginOperatorContext(
          context(),
          SECRET,
          route,
          Number(ISSUED_AT),
        ),
      );
    }
  });

  it('rejects a case-variant dynamic route signed for its lowercase alias', () => {
    const canonicalId = '55555555-5555-4555-8555-55555555555a';
    const canonicalPath = `/v1/plugins/installations/${canonicalId}`;
    const receivedPath = `/v1/plugins/installations/${canonicalId.toUpperCase()}`;

    expectInvalid(() =>
      requireTrustedPluginOperatorContext(
        context({ signature: signature('GET', canonicalPath) }),
        SECRET,
        { method: 'GET', path: receivedPath },
        Number(ISSUED_AT),
      ),
    );
  });

  it('classifies stale, future, and non-canonical evidence as invalid', () => {
    const now = Number(ISSUED_AT);
    const staleIssuedAt = String(now - 61);
    const futureIssuedAt = String(now + 6);

    expectInvalid(() =>
      requireTrustedPluginOperatorContext(
        context({
          issuedAt: staleIssuedAt,
          signature: signature(
            'POST',
            INSTALL_PATH,
            WORKSPACE_ID,
            USER_ID,
            staleIssuedAt,
          ),
        }),
        SECRET,
        { method: 'POST', path: INSTALL_PATH },
        now,
      ),
    );
    expectInvalid(() =>
      requireTrustedPluginOperatorContext(
        context({
          issuedAt: futureIssuedAt,
          signature: signature(
            'POST',
            INSTALL_PATH,
            WORKSPACE_ID,
            USER_ID,
            futureIssuedAt,
          ),
        }),
        SECRET,
        { method: 'POST', path: INSTALL_PATH },
        now,
      ),
    );
    expectInvalid(() =>
      requireTrustedPluginOperatorContext(
        context({ signature: `${signature()}=` }),
        SECRET,
        { method: 'POST', path: INSTALL_PATH },
        now,
      ),
    );
  });

  it('classifies unavailable verifier state separately from invalid evidence', () => {
    expect(() =>
      requireTrustedPluginOperatorContext(
        context(),
        'short',
        { method: 'POST', path: INSTALL_PATH },
        Number(ISSUED_AT),
      ),
    ).toThrowError(
      expect.objectContaining({
        name: 'IntegrationOperatorContextError',
        kind: 'unavailable',
      }),
    );
  });
});
