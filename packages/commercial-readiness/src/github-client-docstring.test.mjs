import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const sourceUrl = new URL('./github-client.mjs', import.meta.url);

function hasContractDocstring(source, declarationPattern) {
  return new RegExp(
    String.raw`\/\*\*[\s\S]*?\*\/[\t ]*\n[\t ]*${declarationPattern}`,
    'm',
  ).test(source);
}

describe('GitHubApiClient retry documentation contract', () => {
  it('documents every production declaration introduced by bounded GET retry', async () => {
    const source = await readFile(sourceUrl, 'utf8');
    const declarations = [
      String.raw`const MAX_READ_ATTEMPTS\s*=`,
      String.raw`const READ_RETRY_DELAYS_MS\s*=`,
      String.raw`const READ_RETRYABLE_STATUSES\s*=`,
      String.raw`function waitForReadRetry\s*\(`,
      String.raw`async requestJson\s*\(`,
    ];

    for (const declaration of declarations) {
      assert.equal(
        hasContractDocstring(source, declaration),
        true,
        `Missing explanatory JSDoc for ${declaration}`,
      );
    }
  });
});
