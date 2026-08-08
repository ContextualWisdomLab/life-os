import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(
  import.meta.dirname,
  '../../../.github/workflows/opencode-commercial-development.yml',
);
const PACKAGE_PATH = resolve(import.meta.dirname, '../package.json');
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'));

/** Returns one named workflow step including its body but not the next step. */
function step(name) {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = workflow.indexOf('\n      - name: ', start + marker.length);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

describe('OpenCode commercial development workflow contract', () => {
  it('runs hourly and manually with one bounded single-flight job', () => {
    expect(workflow).toContain("    - cron: '11 * * * *'");
    expect(workflow).toContain('  workflow_dispatch:');
    expect(workflow).not.toContain('pull_request_target');
    expect(workflow).toContain('permissions: {}');
    expect(workflow).toContain(
      'group: opencode-commercial-development-${{ github.repository }}',
    );
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('timeout-minutes: 120');
  });

  it('provisions the same disposable PostgreSQL boundary used by full CI', () => {
    expect(workflow).toContain(
      'AI_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/life_os_test',
    );
    expect(workflow).toContain(
      'PRIVACY_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/life_os_test',
    );
    expect(workflow).toContain('services:');
    expect(workflow).toContain(
      'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777',
    );
    expect(workflow).toContain('pg_isready -U postgres -d life_os_test');
  });

  it('pins every external action and the reviewed OpenCode package exactly', () => {
    const uses = [...workflow.matchAll(/uses:\s+([^\s#]+)/gu)].map(
      (match) => match[1] ?? '',
    );
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const action of uses) {
      expect(action).toMatch(/^[^@\s]+@[0-9a-f]{40}$/u);
    }
    expect(workflow).toContain(
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    );
    expect(workflow).toContain(
      'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    );
    expect(workflow).toContain(
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    );
    expect(packageJson.devDependencies['opencode-ai']).toMatch(
      /^[0-9]+\.[0-9]+\.[0-9]+$/u,
    );
    expect(workflow).toContain(
      `OPENCODE_PACKAGE_VERSION: '${packageJson.devDependencies['opencode-ai']}'`,
    );
    expect(workflow).not.toContain('__PINNED_BY_BOOTSTRAP__');
    expect(step('Verify the exact OpenCode installation')).toContain(
      'opencode --version',
    );
    expect(step('Verify the exact OpenCode installation')).toContain(
      'opencode run --help',
    );
    expect(step('Verify the exact OpenCode installation')).toContain('--pure');
    expect(workflow).not.toMatch(/curl[^\n]*\|\s*(?:sh|bash)/iu);
  });

  it('keeps the real NVIDIA credential in a loopback bridge, not the model environment', () => {
    expect(workflow).not.toContain('COPILOT_GITHUB_TOKEN');
    expect(
      workflow.match(/\$\{\{ secrets\.NVIDIA_NIM_API_KEY \}\}/gu),
    ).toHaveLength(1);

    const bridge = step('Start loopback NVIDIA credential bridge');
    expect(bridge).toContain('${{ secrets.NVIDIA_NIM_API_KEY }}');
    expect(bridge).toContain('127.0.0.1');
    expect(bridge).toContain('integrate.api.nvidia.com');
    expect(bridge).toContain('/v1/chat/completions');
    expect(bridge).toContain('MAX_REQUEST_BYTES');
    expect(bridge).toContain('MAX_RESPONSE_BYTES');
    expect(bridge).toContain('UPSTREAM_TIMEOUT_SECONDS');
    expect(bridge).toContain('--preserve-env=NVIDIA_NIM_API_KEY');
    expect(bridge).toContain('-u opencode_bridge');
    expect(bridge).not.toContain('echo "$NVIDIA_NIM_API_KEY"');

    const model = step('Run one bounded OpenCode implementation');
    expect(model).toContain('sudo -u opencode_model env -i');
    expect(model).toContain('NVIDIA_API_KEY=local-loopback-placeholder');
    expect(model).toContain('opencode run --pure --auto');
    expect(model).toContain('timeout --signal=TERM --kill-after=30s 90m');
    expect(model).not.toContain('NVIDIA_NIM_API_KEY');
    expect(model).not.toContain('${{ secrets.');
    expect(model).not.toContain('github.token');
    expect(model).not.toContain('GITHUB_TOKEN');
    expect(model).not.toContain('GH_TOKEN');
  });

  it('isolates model writes from git, trusted policy, and trusted verifier authority', () => {
    const workspace = step('Prepare disposable model workspace');
    expect(workspace).toContain('MODEL_WORKSPACE');
    expect(workspace).toContain("--exclude='.git'");
    expect(workspace).toContain("--exclude='node_modules'");
    expect(workspace).toContain('test ! -e "$model_workspace/.git"');
    expect(workspace).toContain('chmod 0700 "$GITHUB_WORKSPACE"');
    expect(workspace).toContain('opencode_model');
    expect(workspace).toContain('iptables');
    expect(workspace).toContain('127.0.0.1');

    const model = step('Run one bounded OpenCode implementation');
    expect(model).toContain('cd "$1"');
    expect(model).toContain('_ "$MODEL_WORKSPACE"');
    expect(model).toContain('OPENCODE_CONFIG="$MODEL_HOME/opencode.json"');
    expect(workspace).toContain("'external_directory': 'deny'");
    expect(workspace).toContain("'webfetch': 'deny'");
    expect(workspace).toContain("'websearch': 'deny'");

    const capture = step('Capture candidate through trusted boundary');
    expect(capture).toContain('packages/commercial-development-agent');
    expect(capture).toContain('--policy "$GITHUB_WORKSPACE/$POLICY_PATH"');
    expect(capture).toContain("stat.S_ISREG");
    expect(capture).toContain('object_type_rejected');
    expect(capture).toContain(
      'node packages/commercial-development-agent/src/cli.mjs validate-diff',
    );
    expect(capture).not.toContain(
      'pnpm --filter @life-os/commercial-development-agent exec commercial-development-agent validate-diff',
    );
  });

  it('renders provider configuration safely and freezes the model writer before evidence', () => {
    const workspace = step('Prepare disposable model workspace');
    expect(workspace).toContain("'$schema': 'https://opencode.ai/config.json'");
    expect(workspace).toContain('MODEL_HOME="$model_home"');
    expect(workspace).toContain('json.dumps(config');
    expect(workspace).not.toContain('"$schema":');

    const model = step('Run one bounded OpenCode implementation');
    expect(model).toContain('pkill --signal TERM --euid opencode_model');
    expect(model).toContain('pgrep --euid opencode_model');
    expect(model).toContain('model_process_cleanup_failed');
    expect(model).toContain('pkill --signal TERM --euid opencode_bridge');
    expect(model).toContain('127.0.0.0/8');
  });

  it('runs generated code verification without credentials or outbound network', () => {
    const verification = step('Verify the accepted repository change');
    expect(verification).toContain('sudo -u opencode_model env -i');
    expect(verification).toContain('cd "$1"');
    expect(verification).toContain('_ "$MODEL_WORKSPACE"');
    expect(verification).toContain('AI_DATABASE_URL="$AI_DATABASE_URL"');
    expect(verification).not.toContain('NVIDIA_API_KEY');
    expect(verification).not.toContain('GH_TOKEN');
    expect(verification).not.toContain('GITHUB_TOKEN');
  });

  it('materializes and stages only the accepted evidence projection', () => {
    const materialize = step(
      'Materialize verified candidate through trusted boundary',
    );
    expect(materialize).toContain("receipt_dir / 'diff.json'");
    expect(materialize).toContain("os.environ['MODEL_WORKSPACE']");
    expect(materialize).toContain('post_verification_candidate_changed');
    expect(materialize).toContain("item['content'].encode('utf-8')");
    expect(materialize).toContain('os.replace');
    expect(materialize).not.toContain('rsync -rt --delete');

    const mutation = step('Commit, push, and open one draft pull request');
    expect(mutation).toContain(
      '--pathspec-from-file="$RECEIPT_DIR/changed-paths.z"',
    );
    expect(mutation).toContain('--pathspec-file-nul');
    expect(mutation).not.toMatch(/git add -A\s*$/mu);
  });

  it('rechecks the live repository lease immediately before both remote writes', () => {
    const mutation = step('Commit, push, and open one draft pull request');
    expect(mutation).toContain('assert_live_lease()');
    expect(
      mutation.match(/^\s*assert_live_lease$/gmu),
    ).toHaveLength(2);
    expect(mutation).toContain('git ls-remote origin refs/heads/main');
    expect(mutation).toContain('pulls?state=open&per_page=1');
    expect(mutation).toContain('selected_issue_digest');
    expect(mutation).toContain('issues/${issue_number}');
    expect(mutation).toContain('remote_branch_created=true');
    expect(mutation).toContain('push origin --delete "$branch"');
    expect(mutation).toContain('[ "$remote_sha" != "$local_sha" ]');
  });

  it('keeps deterministic selection, branch, subprocess, and exact-base gates outside the model', () => {
    expect(
      workflow.indexOf('Run deterministic commercial readiness audit'),
    ).toBeLessThan(workflow.indexOf('Run one bounded OpenCode implementation'));
    expect(step('Select one eligible issue')).toContain(
      'packages/commercial-development-agent/src/cli.mjs select',
    );

    const branch = step('Create the isolated UUIDv4 feature branch');
    expect(branch).toContain('uuid.uuid4()');
    expect(branch).toContain('branch_name="automation/opencode-commercial-');
    expect(branch).toContain('git switch --create "$branch_name"');
    expect(branch).not.toContain('steps.branch.outputs.branch_name');

    const capture = step('Capture candidate through trusted boundary');
    expect(capture).toContain('timeout=30');
    expect(capture).toContain("'ls-remote'");
    expect(capture).toContain("'refs/heads/main'");

    const base = step('Recheck the exact main base before remote mutation');
    expect(base).toContain('timeout 30s git ls-remote origin refs/heads/main');
    expect(base).toContain('base_changed');
  });

  it('allows one credentialed draft-PR mutation step but no merge or release authority', () => {
    const mutation = step('Commit, push, and open one draft pull request');
    expect(mutation).toContain('GH_TOKEN: ${{ github.token }}');
    expect(mutation).toContain('git commit');
    expect(mutation).toContain('push origin "HEAD:${branch}"');
    expect(mutation).toContain('gh pr create');
    expect(mutation).toContain('--draft');
    expect(mutation).not.toContain('gh pr merge');
    expect(mutation).not.toContain('--admin');
    expect(mutation).not.toContain('gh release');
    expect(mutation).not.toContain('git tag');
    expect(workflow).not.toContain('deployments: write');
    expect(workflow).not.toContain('environments: write');
    expect(workflow).not.toContain('actions: write');
  });

  it('retains only credential-free receipts and removes model/bridge material', () => {
    const upload = step('Upload credential-free development receipt');
    expect(upload).toContain(
      'path: ${{ runner.temp }}/commercial-development/receipt.json',
    );
    expect(upload).toContain('if-no-files-found: error');
    expect(upload).toContain('retention-days: 7');
    for (const prohibited of [
      'prompt.json',
      'opencode.log',
      'verification.log',
      'opencode.json',
      'diff.json',
      'changed-paths.z',
      'nim-bridge.py',
    ]) {
      expect(upload).not.toContain(prohibited);
    }

    const cleanup = step('Remove private agent material');
    expect(cleanup).toContain('if: always()');
    expect(cleanup).toContain('pkill --signal TERM --euid opencode_bridge');
    expect(cleanup).toContain('pkill --signal TERM --euid opencode_model');
    expect(cleanup).toContain('MODEL_NETWORK_PHASE');
    expect(cleanup).toContain('iptables -D');
    expect(cleanup).toContain('MODEL_WORKSPACE');
    for (const file of [
      'prompt.json',
      'prompt.txt',
      'opencode.log',
      'issues.json',
      'pulls.json',
      'diff.json',
      'receipt-input.json',
      'nim-bridge.py',
    ]) {
      expect(cleanup).toContain(file);
    }
  });
});
