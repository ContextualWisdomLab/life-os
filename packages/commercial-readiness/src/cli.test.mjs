import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  commandWorkflowRegistry,
  parseArguments,
  readJsonFile,
} from './cli.mjs';

const workflowCommit = 'b'.repeat(40);
const workflowTree = 'c'.repeat(40);
const workflowPath = '.github/workflows/commercial-readiness.yml';

function createWorkflowRegistryClient({
  treePaths = [workflowPath],
  workflows = [
    {
      id: 101,
      name: 'Commercial Readiness',
      path: workflowPath,
      state: 'active',
    },
  ],
  workflowResponse,
} = {}) {
  return {
    async requestJson(path) {
      if (path === '/repos/ContextualWisdomLab/life-os') {
        return { default_branch: 'main' };
      }
      if (path === '/repos/ContextualWisdomLab/life-os/branches/main') {
        return { commit: { sha: workflowCommit } };
      }
      if (
        path ===
        `/repos/ContextualWisdomLab/life-os/git/commits/${workflowCommit}`
      ) {
        return { sha: workflowCommit, tree: { sha: workflowTree } };
      }
      if (
        path ===
        `/repos/ContextualWisdomLab/life-os/git/trees/${workflowTree}?recursive=1`
      ) {
        return {
          truncated: false,
          tree: treePaths.map((entryPath) => ({
            path: entryPath,
            type: 'blob',
          })),
        };
      }
      if (
        path ===
        '/repos/ContextualWisdomLab/life-os/actions/workflows?per_page=100&page=1'
      ) {
        return workflowResponse ?? { total_count: workflows.length, workflows };
      }
      throw new Error(`Unexpected GitHub test request: ${path}`);
    },
  };
}

describe('parseArguments', () => {
  it('parses bounded command options without interpreting values as shell syntax', () => {
    assert.deepEqual(
      parseArguments([
        'snapshot',
        '--repository',
        'ContextualWisdomLab/life-os',
        '--policy',
        'product/commercial-readiness-policy.json',
        '--output',
        'out/snapshot.json',
        '--commit',
        'a'.repeat(40),
      ]),
      {
        command: 'snapshot',
        options: {
          repository: 'ContextualWisdomLab/life-os',
          policy: 'product/commercial-readiness-policy.json',
          output: 'out/snapshot.json',
          commit: 'a'.repeat(40),
        },
      },
    );
  });

  it('parses the read-only workflow registry evidence command', () => {
    assert.deepEqual(
      parseArguments([
        'workflow-registry',
        '--repository',
        'ContextualWisdomLab/life-os',
        '--commit',
        'b'.repeat(40),
        '--generated-at',
        '2026-08-13T11:30:00.000Z',
        '--output',
        'out/workflow-registry.json',
      ]),
      {
        command: 'workflow-registry',
        options: {
          repository: 'ContextualWisdomLab/life-os',
          commit: 'b'.repeat(40),
          generatedAt: '2026-08-13T11:30:00.000Z',
          output: 'out/workflow-registry.json',
        },
      },
    );
  });

  it('rejects unknown commands, duplicate options, missing values, and positional arguments', () => {
    for (const argv of [
      ['unknown'],
      ['snapshot', '--repository', 'o/r', '--repository', 'o/r'],
      ['snapshot', '--repository'],
      ['snapshot', 'unexpected'],
      ['drain', '--execute'],
    ]) {
      assert.throws(
        () => parseArguments(argv),
        /Invalid commercial readiness command/,
      );
    }
  });
});

describe('commandWorkflowRegistry', () => {
  it('persists realistic orphan-free workflow registry evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'life-os-workflow-registry-'));
    const output = join(root, 'workflow-registry.json');

    await commandWorkflowRegistry(
      {
        repository: 'ContextualWisdomLab/life-os',
        commit: workflowCommit,
        generatedAt: '2026-08-13T11:30:00.000Z',
        output,
      },
      createWorkflowRegistryClient(),
    );

    const evidence = await readJsonFile(output);
    assert.equal(evidence.schema, 'life-os.workflow-registry-snapshot.v1');
    assert.equal(evidence.commit_sha, workflowCommit);
    assert.equal(evidence.tree_sha, workflowTree);
    assert.equal(evidence.workflow_count, 1);
    assert.deepEqual(evidence.active_orphans, []);
    assert.deepEqual(evidence.present, [
      {
        id: 101,
        name: 'Commercial Readiness',
        path: workflowPath,
        state: 'active',
      },
    ]);
  });

  it('persists active-orphan evidence before failing the command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'life-os-workflow-registry-'));
    const output = join(root, 'workflow-registry.json');
    const orphan = {
      id: 202,
      name: 'Legacy repair',
      path: '.github/workflows/legacy-repair.yml',
      state: 'active',
    };

    await assert.rejects(
      () =>
        commandWorkflowRegistry(
          {
            repository: 'ContextualWisdomLab/life-os',
            commit: workflowCommit,
            generatedAt: '2026-08-13T11:30:00.000Z',
            output,
          },
          createWorkflowRegistryClient({ treePaths: [], workflows: [orphan] }),
        ),
      /contains 1 active orphan identity record/,
    );

    const evidence = await readJsonFile(output);
    assert.deepEqual(evidence.active_orphans, [orphan]);
    assert.equal(evidence.registry_receipt.total_count, 1);
  });

  it('fails closed on incomplete registry collection without publishing a snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'life-os-workflow-registry-'));
    const output = join(root, 'workflow-registry.json');

    await assert.rejects(
      () =>
        commandWorkflowRegistry(
          {
            repository: 'ContextualWisdomLab/life-os',
            commit: workflowCommit,
            generatedAt: '2026-08-13T11:30:00.000Z',
            output,
          },
          createWorkflowRegistryClient({
            workflowResponse: {
              total_count: 2,
              workflows: [
                {
                  id: 101,
                  name: 'Commercial Readiness',
                  path: workflowPath,
                  state: 'active',
                },
              ],
            },
          }),
        ),
      /pagination was truncated/,
    );
    await assert.rejects(
      () => readJsonFile(output),
      (error) => error?.code === 'ENOENT',
    );
  });
});

describe('readJsonFile', () => {
  it('reads bounded regular JSON files and rejects symlinks or oversized input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'life-os-cli-'));
    const valid = join(root, 'valid.json');
    const target = join(root, 'target.json');
    const link = join(root, 'link.json');
    const large = join(root, 'large.json');
    await writeFile(valid, '{"ok":true}', 'utf8');
    await writeFile(target, '{"secret":true}', 'utf8');
    await symlink(target, link);
    await writeFile(large, JSON.stringify({ value: 'x'.repeat(2048) }), 'utf8');

    assert.deepEqual(await readJsonFile(valid, 1024), { ok: true });
    await assert.rejects(
      () => readJsonFile(link, 1024),
      /JSON input must be a regular file/,
    );
    await assert.rejects(
      () => readJsonFile(large, 1024),
      /JSON input exceeded the size limit/,
    );
  });
});
