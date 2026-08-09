import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseBuyerGapArguments } from './buyer-gap-cli.mjs';

const validArguments = [
  '--repository',
  'ContextualWisdomLab/life-os',
  '--manifest',
  'product/capabilities.json',
  '--buyer-gaps',
  'product/buyer-gaps.json',
  '--snapshot',
  'evidence/github-snapshot.json',
  '--policy',
  'product/commercial-readiness-policy.json',
  '--root',
  '.',
  '--output-json',
  'evidence/commercial-readiness.json',
  '--output-markdown',
  'evidence/commercial-readiness.md',
];

describe('parseBuyerGapArguments', () => {
  it('accepts the fixed bounded workflow surface', () => {
    assert.deepEqual(parseBuyerGapArguments(validArguments), {
      repository: 'ContextualWisdomLab/life-os',
      manifest: 'product/capabilities.json',
      buyerGaps: 'product/buyer-gaps.json',
      snapshot: 'evidence/github-snapshot.json',
      policy: 'product/commercial-readiness-policy.json',
      root: '.',
      outputJson: 'evidence/commercial-readiness.json',
      outputMarkdown: 'evidence/commercial-readiness.md',
    });
  });

  it('rejects unknown, duplicate, missing, and control-character arguments', () => {
    for (const argv of [
      validArguments.slice(0, -2),
      [...validArguments, '--unknown', 'value'],
      [...validArguments, '--root', '.'],
      validArguments.map((value, index) =>
        index === 1 ? 'ContextualWisdomLab/life-os\nother' : value,
      ),
    ]) {
      assert.throws(
        () => parseBuyerGapArguments(argv),
        /Invalid buyer gap audit command/,
      );
    }
  });
});
