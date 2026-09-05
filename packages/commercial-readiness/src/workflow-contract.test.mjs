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

function yamlTopLevelBlock(source, key) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `${key}:`);
  assert.notEqual(start, -1, `missing top-level YAML key: ${key}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z0-9_.-]+:\s*(?:#.*)?$/u.test(lines[index] ?? '')) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function yamlChildBlock(source, key) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${key}:`);
  assert.notEqual(start, -1, `missing YAML child key: ${key}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_.-]+:\s*(?:#.*)?$/u.test(lines[index] ?? '')) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function yamlJobBlock(source, jobName) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `missing workflow job: ${jobName}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_.-]+:\s*(?:#.*)?$/u.test(lines[index] ?? '')) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function assertUsefulPullRequestTrigger(path, workflow) {
  const triggerBlock = yamlTopLevelBlock(workflow, 'on');
  const pullRequestBlock = yamlChildBlock(triggerBlock, 'pull_request');
  assert.match(
    pullRequestBlock,
    /^\s+types:\s*\[opened, synchronize, reopened, ready_for_review\]\s*$/mu,
    `${path} must reacquire exact-head evidence when a draft becomes ready without creating a no-op draft-transition run`,
  );
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

  it('cancels only superseded heads from the same pull request', async () => {
    const paths = [
      '.github/workflows/appguardrail.yml',
      '.github/workflows/ci.yml',
      '.github/workflows/commercial-readiness.yml',
    ];
    for (const path of paths) {
      const workflow = await repositoryFile(path);
      assert.match(
        workflow,
        /group:\s*\$\{\{ github\.workflow \}\}-\$\{\{ github\.repository \}\}-\$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.number \|\| github\.run_id \}\}/,
        path,
      );
      assert.match(
        workflow,
        /cancel-in-progress:\s*\$\{\{ github\.event_name == 'pull_request' \}\}/,
        path,
      );
    }
  });

  it('keeps draft pull requests off LifeOS-owned hosted runners and reruns when review starts', async () => {
    const malformedTriggerFixture = [
      'name: false-positive-trigger-fixture',
      '',
      'on:',
      '  pull_request:',
      '    branches: [main]',
      '  workflow_dispatch:',
      '    types: [opened, synchronize, reopened, ready_for_review]',
      '',
      'jobs:',
    ].join('\n');
    assert.throws(
      () =>
        assertUsefulPullRequestTrigger(
          'false-positive-trigger-fixture.yml',
          malformedTriggerFixture,
        ),
      { name: 'AssertionError' },
      'trigger contract must reject draft-transition types declared outside pull_request',
    );

    const workflows = [
      {
        path: '.github/workflows/appguardrail.yml',
        jobs: ['scan'],
      },
      {
        path: '.github/workflows/ci.yml',
        jobs: [
          'compose_runtime',
          'today-concurrency',
          'validate',
          'browser-acceptance',
        ],
      },
      {
        path: '.github/workflows/commercial-readiness.yml',
        jobs: ['audit'],
      },
    ];

    for (const { path, jobs } of workflows) {
      const workflow = await repositoryFile(path);
      assertUsefulPullRequestTrigger(path, workflow);
      assert.doesNotMatch(
        yamlChildBlock(yamlTopLevelBlock(workflow, 'on'), 'pull_request'),
        /converted_to_draft/u,
        `${path} must not create a workflow run solely to skip draft work`,
      );
      for (const job of jobs) {
        assert.match(
          yamlJobBlock(workflow, job),
          /^\s+if:\s*\$\{\{ github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft == false \}\}\s*$/mu,
          `${path}:${job} must not allocate a hosted runner while the pull request is draft`,
        );
      }
    }

    const ciWorkflow = await repositoryFile('.github/workflows/ci.yml');
    assert.match(
      yamlJobBlock(ciWorkflow, 'merge_compatibility'),
      /^\s+if:\s*\$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.draft == false \}\}\s*$/mu,
      'merge compatibility must remain pull-request-only while skipping drafts',
    );
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

  it('binds browser acceptance commands to the pull-request CI job', async () => {
    const workflow = await repositoryFile('.github/workflows/ci.yml');
    const triggerBlock = yamlTopLevelBlock(workflow, 'on');
    const browserJob = yamlJobBlock(workflow, 'browser-acceptance');

    assert.match(triggerBlock, /^  pull_request:\s*$/mu);
    assert.match(
      browserJob,
      /^\s+run:\s*pnpm --filter @life-os\/web exec playwright install --with-deps chromium\s*$/mu,
    );
    assert.match(
      browserJob,
      /^\s+run:\s*pnpm --filter @life-os\/web test:e2e\s*$/mu,
    );
  });

  it('pins every LifeOS-owned hosted-runner workflow to the explicit supported Ubuntu image', async () => {
    const ciWorkflow = await repositoryFile('.github/workflows/ci.yml');
    const ciJobs = [
      'compose_runtime',
      'today-concurrency',
      'validate',
      'browser-acceptance',
      'merge_compatibility',
    ];

    for (const job of ciJobs) {
      assert.match(
        yamlJobBlock(ciWorkflow, job),
        /^\s+runs-on:\s*ubuntu-24\.04\s*$/mu,
        `${job} must use the explicit supported GitHub-hosted runner image`,
      );
    }

    const hostedRunnerWorkflows = [
      '.github/workflows/ai-proposal-live-conformance.yml',
      '.github/workflows/appguardrail.yml',
      '.github/workflows/ci.yml',
      '.github/workflows/commercial-readiness.yml',
      '.github/workflows/deploy.yml',
      '.github/workflows/opencode-commercial-development.yml',
    ];
    for (const path of hostedRunnerWorkflows) {
      const workflow = await repositoryFile(path);
      const runners = [...workflow.matchAll(/^\s*runs-on:\s*(\S+)\s*$/gmu)].map(
        ([, runner]) => runner,
      );
      assert.ok(runners.length > 0, `${path} must define a hosted runner`);
      for (const runner of runners) {
        assert.equal(
          runner,
          'ubuntu-24.04',
          `${path} must use ubuntu-24.04 for every hosted runner job`,
        );
      }
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
