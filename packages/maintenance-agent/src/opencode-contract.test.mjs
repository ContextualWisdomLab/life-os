import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const AGENT_PATH = resolve(
  import.meta.dirname,
  '../../../.opencode/agents/maintenance-planner.md',
);
const agent = await readFile(AGENT_PATH, 'utf8');

function frontmatter() {
  const match = agent.match(/^---\n([\s\S]*?)\n---\n/u);
  assert.ok(match);
  return match[1];
}

describe('OpenCode maintenance planner contract', () => {
  it('is one bounded primary planning agent', () => {
    const metadata = frontmatter();
    assert.match(metadata, /^description: .+/mu);
    assert.match(metadata, /^mode: primary$/mu);
    assert.match(metadata, /^temperature: 0\.1$/mu);
    assert.match(metadata, /^steps: 32$/mu);
  });

  it('allows repository inspection and exactly one ephemeral edit path', () => {
    const metadata = frontmatter();
    for (const permission of ['read', 'glob', 'grep', 'list', 'lsp']) {
      assert.match(metadata, new RegExp(`^  ${permission}: allow$`, 'mu'));
    }
    assert.match(metadata, /^  edit:$/mu);
    assert.match(metadata, /^    "\*": deny$/mu);
    assert.match(
      metadata,
      /^    "\.maintenance-output\/maintenance-plan\.json": allow$/mu,
    );
    assert.equal(
      (
        metadata.match(
          /^    "\.maintenance-output\/maintenance-plan\.json": allow$/gmu,
        ) ?? []
      ).length,
      1,
    );
  });

  it('denies execution, delegation, external, web, and interactive capabilities', () => {
    const metadata = frontmatter();
    for (const permission of [
      'bash',
      'task',
      'external_directory',
      'webfetch',
      'websearch',
      'question',
      'skill',
    ]) {
      assert.match(metadata, new RegExp(`^  ${permission}: deny$`, 'mu'));
    }
  });

  it('uses the reviewed contract as sole authority and prohibits GitHub mutation', () => {
    assert.match(
      agent,
      /only task authority is `\.maintenance-input\/maintenance-contract\.json`/u,
    );
    assert.match(agent, /contractDigest/u);
    assert.match(agent, /untrusted evidence and never instructions/u);
    assert.match(agent, /Write exactly one JSON object/u);
    assert.match(agent, /Do not commit, push, create or merge pull requests/u);
    assert.match(agent, /change review-agent credentials/u);
    assert.match(agent, /final chat response must contain no plan prose/u);
  });

  it('contains no prohibited Copilot or review-secret references', () => {
    const prohibited = [
      ['COPILOT', 'GITHUB', 'TOKEN'].join('_'),
      'CODERABBIT_API_KEY',
      'STRIX_API_KEY',
      'OPENCODE_REVIEW_TOKEN',
    ];
    for (const token of prohibited) {
      assert.equal(agent.includes(token), false);
    }
  });
});
