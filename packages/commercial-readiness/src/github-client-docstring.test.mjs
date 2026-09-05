import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const sourceUrl = new URL('./github-client.mjs', import.meta.url);

function hasContractDocstring(source, declarationPattern, requiredSnippets) {
  const match = new RegExp(
    String.raw`(\/\*\*[\s\S]*?\*\/)[\t ]*\n[\t ]*${declarationPattern}`,
    'm',
  ).exec(source);
  if (!match) return false;
  return requiredSnippets.every((snippet) => match[1].includes(snippet));
}

describe('GitHubApiClient retry documentation contract', () => {
  it('rejects empty or unrelated JSDoc attached to a retry declaration', () => {
    const declaration = String.raw`const MAX_READ_ATTEMPTS\s*=`;
    const requiredSnippets = [
      'idempotent GitHub GET',
      'including the first request',
    ];

    assert.equal(
      hasContractDocstring(
        `/** Unrelated documentation. */\nconst MAX_READ_ATTEMPTS = 3;`,
        declaration,
        requiredSnippets,
      ),
      false,
    );
    assert.equal(
      hasContractDocstring(
        `/** */\nconst MAX_READ_ATTEMPTS = 3;`,
        declaration,
        requiredSnippets,
      ),
      false,
    );
  });

  it('documents every production declaration introduced by bounded GET retry', async () => {
    const source = await readFile(sourceUrl, 'utf8');
    const declarations = [
      {
        pattern: String.raw`const MAX_READ_ATTEMPTS\s*=`,
        requiredSnippets: [
          'idempotent GitHub GET',
          'including the first request',
        ],
      },
      {
        pattern: String.raw`const READ_RETRY_DELAYS_MS\s*=`,
        requiredSnippets: ['Backoff delays', 'milliseconds'],
      },
      {
        pattern: String.raw`const READ_RETRYABLE_STATUSES\s*=`,
        requiredSnippets: ['Transient server statuses', 'method is GET'],
      },
      {
        pattern: String.raw`function waitForReadRetry\s*\(`,
        requiredSnippets: [
          'completed retryable GET attempt',
          '@param {number} attempt',
          '@returns {Promise<void>}',
        ],
      },
      {
        pattern: String.raw`async requestJson\s*\(`,
        requiredSnippets: [
          'mutation exactly-once semantics',
          'HTTP 500, 502, 503, or 504',
          'non-GET request',
          '@param {string} path',
          '@returns {Promise<unknown>}',
        ],
      },
    ];

    for (const { pattern, requiredSnippets } of declarations) {
      assert.equal(
        hasContractDocstring(source, pattern, requiredSnippets),
        true,
        `Missing explanatory JSDoc for ${pattern}`,
      );
    }
  });
});
