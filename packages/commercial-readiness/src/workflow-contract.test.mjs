import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repositoryRoot = process.env.LIFE_OS_REPOSITORY_ROOT
  ? resolve(process.env.LIFE_OS_REPOSITORY_ROOT)
  : resolve(fileURLToPath(new URL('../../../', import.meta.url)));

async function repositoryFile(path) {
  return await readFile(resolve(repositoryRoot, path), 'utf8');
}

describe('commercial readiness workflow contract', () => {
  it('runs hourly at a non-round minute and keeps writes off pull requests', async () => {
    const workflow = await repositoryFile(
      '.github/workflows/commercial-readiness.yml',
    );
    assert.match(workflow, /cron:\s*["']23 \* \* \* \*["']/);
    assert.match(workflow, /pull_request:/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /github\.event_name != 'pull_request'/);
    assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  });

  it('isolates scheduled drains from push-triggered publication runs', async () => {
    const workflow = await repositoryFile(
      '.github/workflows/commercial-readiness.yml',
    );
    assert.match(
      workflow,
      /group:\s*\$\{\{ github\.workflow \}\}-\$\{\{ github\.event_name \}\}-/,
    );
    assert.match(workflow, /cancel-in-progress:\s*true/);
  });

  it('pins every external action to a full commit SHA and retains evidence for no more than seven days', async () => {
    const workflow = await repositoryFile(
      '.github/workflows/commercial-readiness.yml',
    );
    const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map(
      (match) => match[1],
    );
    assert.ok(uses.length >= 4);
    for (const action of uses) {
      assert.match(action, /@[0-9a-f]{40}$/i, action);
    }
    for (const match of workflow.matchAll(/retention-days:\s*(\d+)/g)) {
      assert.ok(Number(match[1]) <= 7);
    }
  });

  it('requires all review and security gates before merge mode can execute', async () => {
    const policy = JSON.parse(
      await repositoryFile('product/commercial-readiness-policy.json'),
    );
    assert.deepEqual(policy.required_workflows, [
      'CI',
      'SAST Semgrep',
      'Security Scan',
      'AppGuardrail',
      'Commercial Readiness',
    ]);
    assert.deepEqual(policy.required_statuses, ['CodeRabbit']);
    const workflow = await repositoryFile(
      '.github/workflows/commercial-readiness.yml',
    );
    assert.match(workflow, /drain[\s\S]*--merge/);
    assert.doesNotMatch(workflow, /admin|force-push|--force/);
  });
});
