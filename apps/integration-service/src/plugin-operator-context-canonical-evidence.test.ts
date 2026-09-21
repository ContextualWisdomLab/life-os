import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  IntegrationOperatorContextError,
  requireVerifiedPluginOperatorContext,
  type IntegrationOperatorContextHeaders,
} from './plugin-operator-context';

const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';
const EVIDENCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ISSUED_AT = '1790000000';
const SECRET = Buffer.alloc(32, 0x49).toString('base64url');
const METHOD = 'POST';
const PATH = '/v1/plugins/installations';

/** Creates the exact signer-issued Integration operator context. */
function signedContext(): IntegrationOperatorContextHeaders {
  const signature = createHmac('sha256', SECRET)
    .update(
      `life-os.integration-operator-context.v1\n${WORKSPACE_ID}\n${USER_ID}\n${EVIDENCE_ID}\n${ISSUED_AT}\n${METHOD}\n${PATH}`,
      'utf8',
    )
    .digest('base64url');
  return {
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    evidenceId: EVIDENCE_ID,
    issuedAt: ISSUED_AT,
    signature,
  };
}

/** Requires altered signer-issued identity evidence to fail closed before replay authority is derived. */
function expectInvalid(headers: IntegrationOperatorContextHeaders): void {
  expect(() =>
    requireVerifiedPluginOperatorContext(
      headers,
      SECRET,
      { method: METHOD, path: PATH },
      Number(ISSUED_AT),
    ),
  ).toThrowError(
    expect.objectContaining<Partial<IntegrationOperatorContextError>>({
      name: 'IntegrationOperatorContextError',
      kind: 'invalid',
    }),
  );
}

describe('Integration operator signed identity evidence canonicality', () => {
  it.each([
    ['workspaceId', WORKSPACE_ID.toUpperCase()],
    ['userId', USER_ID.toUpperCase()],
    ['evidenceId', EVIDENCE_ID.toUpperCase()],
  ] as const)(
    'rejects a byte-different %s case alias without a new signature',
    (field, alteredValue) => {
      const canonical = signedContext();
      expect(alteredValue).not.toBe(canonical[field]);
      expectInvalid({ ...canonical, [field]: alteredValue });
    },
  );
});
