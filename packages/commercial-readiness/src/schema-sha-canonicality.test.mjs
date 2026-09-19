import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateGitHubSnapshot } from './schema.mjs';

const LOWER_SHA = 'a'.repeat(40);
const UPPER_SHA = 'A'.repeat(40);

function snapshot() {
  return {
    schema: 'life-os.github-snapshot.v1',
    repository: 'ContextualWisdomLab/life-os',
    commit_sha: LOWER_SHA,
    generated_at: '2026-09-07T00:00:00.000Z',
    truncated: false,
    pull_requests: [
      {
        number: 247,
        title: 'fix(actions): preserve canonical SHA evidence',
        state: 'open',
        draft: false,
        mergeable: true,
        mergeable_state: 'clean',
        base_ref: 'main',
        head_sha: LOWER_SHA,
        head_repo: 'ContextualWisdomLab/life-os',
        repository: 'ContextualWisdomLab/life-os',
        author_association: 'OWNER',
        behind_by: 0,
        reviews: [],
        unresolved_threads: 0,
        workflows: [
          {
            name: 'CI',
            status: 'completed',
            conclusion: 'success',
            head_sha: LOWER_SHA,
            run_attempt: 1,
            updated_at: '2026-09-07T00:00:00Z',
          },
        ],
        statuses: [
          {
            context: 'CodeRabbit',
            state: 'success',
            sha: LOWER_SHA,
          },
        ],
        eligible: false,
        blockers: ['missing-approval'],
      },
    ],
    issues: [],
  };
}

describe('GitHub snapshot SHA canonicality', () => {
  it('accepts lowercase canonical 40-hex SHA evidence unchanged', () => {
    const validated = validateGitHubSnapshot(snapshot());
    assert.equal(validated.commit_sha, LOWER_SHA);
    assert.equal(validated.pull_requests[0].head_sha, LOWER_SHA);
    assert.equal(validated.pull_requests[0].workflows[0].head_sha, LOWER_SHA);
    assert.equal(validated.pull_requests[0].statuses[0].sha, LOWER_SHA);
  });

  it('rejects uppercase aliases instead of recanonicalizing durable SHA authority', () => {
    const rootCommit = snapshot();
    rootCommit.commit_sha = UPPER_SHA;

    const pullHead = snapshot();
    pullHead.pull_requests[0].head_sha = UPPER_SHA;

    const workflowHead = snapshot();
    workflowHead.pull_requests[0].workflows[0].head_sha = UPPER_SHA;

    const statusHead = snapshot();
    statusHead.pull_requests[0].statuses[0].sha = UPPER_SHA;

    for (const candidate of [rootCommit, pullHead, workflowHead, statusHead]) {
      assert.throws(
        () => validateGitHubSnapshot(candidate),
        /Invalid GitHub snapshot/,
      );
    }
  });
});
