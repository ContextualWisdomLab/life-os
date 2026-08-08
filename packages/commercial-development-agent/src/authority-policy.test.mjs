import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateCommercialDevelopmentDiff } from './diff-validator.mjs';

const POLICY = JSON.parse(
  readFileSync(
    new URL(
      '../../../product/opencode-commercial-development-policy.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const BASE_SHA = 'a'.repeat(40);

/** Returns one syntactically valid single-file candidate change. */
function candidate(path) {
  const content = 'export const candidateValue = true;\n';
  return {
    base_sha: BASE_SHA,
    current_base_sha: BASE_SHA,
    files: [
      {
        path,
        status: 'M',
        bytes: Buffer.byteLength(content, 'utf8'),
        additions: 1,
        deletions: 1,
        binary: false,
        symlink: false,
        submodule: false,
        content,
      },
    ],
  };
}

describe('commercial development authority boundary', () => {
  it.each([
    'packages/commercial-development-agent/src/diff-validator.mjs',
    'product/opencode-commercial-development-policy.json',
    '.github/workflows/opencode-commercial-development.yml',
  ])('rejects candidate mutation of trusted authority path %s', (path) => {
    expect(
      validateCommercialDevelopmentDiff(candidate(path), POLICY),
    ).toMatchObject({
      accepted: false,
      reason_code: 'path_rejected',
    });
  });
});
