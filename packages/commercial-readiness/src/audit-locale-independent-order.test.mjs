import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SOURCE_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));

const PROBE = String.raw`
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { evaluateCapabilities } = await import(
  pathToFileURL(join(process.cwd(), 'audit.mjs')).href
);
const capabilities = [
  {
    id: 'aa.a',
    outcome: 'First equal-priority capability',
    target_maturity: 'prototype',
    customer_impact: 1,
    risk: 1,
    acquisition_impact: 1,
    effort: 1,
    dependencies: [],
    tracking_issue: 1,
    evidence: [],
  },
  {
    id: 'ab.a',
    outcome: 'Second equal-priority capability',
    target_maturity: 'prototype',
    customer_impact: 1,
    risk: 1,
    acquisition_impact: 1,
    effort: 1,
    dependencies: [],
    tracking_issue: 2,
    evidence: [],
  },
];
const report = await evaluateCapabilities(
  { capabilities },
  {
    rootDir: process.cwd(),
    generatedAt: '2026-09-14T00:00:00Z',
    commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
);
process.stdout.write(JSON.stringify(report.gaps.map((gap) => gap.capability_id)));
`;

function gapOrderFor(locale) {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', PROBE],
    {
      cwd: SOURCE_DIRECTORY,
      env: { ...process.env, LANG: locale, LC_ALL: locale },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr || `probe failed for ${locale}`);
  return JSON.parse(result.stdout);
}

describe('commercial readiness report ordering', () => {
  it('keeps equal-priority capability gaps byte-stable across ambient locales', () => {
    const englishOrder = gapOrderFor('en_US.UTF-8');
    const danishOrder = gapOrderFor('da_DK.UTF-8');

    assert.deepEqual(englishOrder, ['aa.a', 'ab.a']);
    assert.deepEqual(danishOrder, englishOrder);
  });
});
