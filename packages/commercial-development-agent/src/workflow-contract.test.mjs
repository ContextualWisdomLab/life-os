import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(
  import.meta.dirname,
  '../../../.github/workflows/opencode-commercial-development.yml',
);
const CI_WORKFLOW_PATH = resolve(
  import.meta.dirname,
  '../../../.github/workflows/ci.yml',
);
const COMPOSE_PATH = resolve(import.meta.dirname, '../../../compose.yaml');
const PACKAGE_PATH = resolve(import.meta.dirname, '../package.json');
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
const ciWorkflow = readFileSync(CI_WORKFLOW_PATH, 'utf8');
const compose = readFileSync(COMPOSE_PATH, 'utf8');
const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'));
const linuxX64Test =
  process.platform === 'linux' && process.arch === 'x64' ? it : it.skip;

/** Returns one named workflow step including its body but not the next step. */
function namedStep(source, name) {
  const marker = `      - name: ${name}\n`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\n      - name: ', start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

/** Returns one named OpenCode workflow step. */
function step(name) {
  return namedStep(workflow, name);
}

/** Returns one top-level CI job including its body but not the next job. */
function ciJob(name) {
  const marker = `  ${name}:\n`;
  const start = ciWorkflow.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const remainder = ciWorkflow.slice(start + marker.length);
  const next = remainder.search(/^  [a-z][a-z0-9_]*:\n/mu);
  return ciWorkflow.slice(
    start,
    next === -1 ? ciWorkflow.length : start + marker.length + next,
  );
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

  it('initializes runner temp only after the runner starts', () => {
    const jobsStart = workflow.indexOf('\njobs:\n');
    const stepsStart = workflow.indexOf('\n    steps:\n', jobsStart);
    expect(jobsStart).toBeGreaterThanOrEqual(0);
    expect(stepsStart).toBeGreaterThan(jobsStart);
    expect(workflow.slice(0, stepsStart)).not.toContain('${{ runner.');

    const evidence = step('Prepare private evidence directory');
    expect(evidence).toContain(
      'receipt_dir="$RUNNER_TEMP/commercial-development"',
    );
    expect(evidence).toContain(
      'echo "RECEIPT_DIR=$receipt_dir" >> "$GITHUB_ENV"',
    );
  });

  it('paginates GitHub evidence into one fail-closed JSON array per resource', () => {
    const evidence = step(
      'Collect bounded GitHub issue and pull request evidence',
    );

    expect(evidence).toContain('set -Eeuo pipefail');
    expect(evidence.match(/--paginate/gu)).toHaveLength(2);
    expect(evidence.match(/\| jq -s '\.'/gu)).toHaveLength(2);
    expect(evidence).not.toContain("--jq '[.[]");
    expect(evidence).toContain('> "$RECEIPT_DIR/issues.json"');
    expect(evidence).toContain('> "$RECEIPT_DIR/pulls.json"');
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

  it('uses one offline explicit NVIDIA model catalog instead of provider model discovery', () => {
    const workspace = step('Prepare disposable model workspace');
    expect(workspace).toContain("'enabled_providers': ['nvidia']");
    expect(workspace).toContain("'model': model_label");
    expect(workspace).toContain("'small_model': model_label");
    expect(workspace).toContain("'whitelist': [model_id]");
    expect(workspace).toContain("'models': {model_id: {'name': model_id}}");
    expect(workspace).toContain("model_workspace_path / 'AGENTS.md'");
    expect(workspace).toContain("model_workspace_path / 'CLAUDE.md'");
    expect(workspace).toContain("'instructions': instruction_paths");
    expect(workspace).toContain("model_label.partition('/')");
    expect(workspace).toContain("provider_id != 'nvidia'");

    const catalog = step('Validate the explicit OpenCode model catalog');
    expect(catalog).toContain('sudo -u opencode_model env -i');
    expect(catalog).toContain('OPENCODE_DISABLE_MODELS_FETCH=true');
    expect(catalog).toContain('OPENCODE_DISABLE_PROJECT_CONFIG=true');
    expect(catalog).toContain('opencode models nvidia');
    expect(catalog).toContain('test "$catalog" = "$2"');
    expect(catalog).not.toContain('NVIDIA_NIM_API_KEY');
    expect(catalog).not.toContain('/v1/models');

    const model = step('Run one bounded OpenCode implementation');
    expect(model).toContain('OPENCODE_DISABLE_MODELS_FETCH=true');
    expect(model).toContain('OPENCODE_DISABLE_PROJECT_CONFIG=true');
  });

  linuxX64Test(
    'registers a NVIDIA model absent from the bundled OpenCode catalog without discovery',
    () => {
      const temporaryRoot = mkdtempSync(
        join(tmpdir(), 'life-os-opencode-catalog-'),
      );
      try {
        const modelId = 'cwl/contract-probe-model-v1';
        const modelLabel = `nvidia/${modelId}`;
        const loopbackCredential = ['local', 'loopback', 'placeholder'].join('-');
        const opencodePackage = realpathSync(
          resolve(import.meta.dirname, '../node_modules/opencode-ai'),
        );
        const executable = resolve(
          dirname(opencodePackage),
          'opencode-linux-x64/bin/opencode',
        );
        const directories = Object.fromEntries(
          ['home', 'cache', 'config', 'data', 'state'].map((name) => {
            const path = resolve(temporaryRoot, name);
            mkdirSync(path, { mode: 0o700 });
            return [name, path];
          }),
        );
        const config = JSON.stringify({
          enabled_providers: ['nvidia'],
          model: modelLabel,
          small_model: modelLabel,
          provider: {
            nvidia: {
              whitelist: [modelId],
              models: { [modelId]: { name: modelId } },
              options: {
                baseURL: 'http://127.0.0.1:8765/v1',
                apiKey: loopbackCredential,
              },
            },
          },
        });

        const result = spawnSync(executable, ['models', 'nvidia'], {
          cwd: resolve(import.meta.dirname, '../../..'),
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            HOME: directories.home,
            PATH: process.env.PATH ?? '/usr/bin:/bin',
            XDG_CACHE_HOME: directories.cache,
            XDG_CONFIG_HOME: directories.config,
            XDG_DATA_HOME: directories.data,
            XDG_STATE_HOME: directories.state,
            OPENCODE_CONFIG_CONTENT: config,
            OPENCODE_DISABLE_AUTOUPDATE: 'true',
            OPENCODE_DISABLE_MODELS_FETCH: 'true',
            OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
            NVIDIA_API_KEY: loopbackCredential,
          },
        });

        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout.trim()).toBe(modelLabel);
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    },
  );

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
    expect(capture).toContain('stat.S_ISREG');
    expect(capture).toContain('object_type_rejected');
    expect(capture).toContain(
      'node packages/commercial-development-agent/src/cli.mjs validate-diff',
    );
    expect(capture).not.toContain(
      'pnpm --filter @life-os/commercial-development-agent exec commercial-development-agent validate-diff',
    );
  });

  it('restores every tracked path and preloads an immutable Corepack cache before denying network', () => {
    const workspace = step('Prepare disposable model workspace');
    const model = step('Run one bounded OpenCode implementation');
    const verification = step('Verify the accepted repository change');
    const cleanup = step('Remove private agent material');

    expect(workspace).toContain('git -C "$GITHUB_WORKSPACE" ls-files -z |');
    expect(workspace).toContain('rsync -a --from0 --files-from=-');

    const cacheInstall = workspace.indexOf(
      'corepack install --global "$package_manager"',
    );
    const networkDeny = workspace.indexOf(
      'iptables -I OUTPUT 1 -m owner --uid-owner "$model_uid" -j REJECT',
    );
    expect(cacheInstall).toBeGreaterThanOrEqual(0);
    expect(networkDeny).toBeGreaterThan(cacheInstall);
    expect(workspace).toContain(
      'chmod -R u=rwX,go=rX "$trusted_corepack_home"',
    );
    expect(workspace).not.toMatch(/chown[^\n]*trusted_corepack_home/u);

    expect(workspace).toContain('COREPACK_HOME="$trusted_corepack_home"');
    for (const isolatedStep of [model, verification]) {
      expect(isolatedStep).toContain('COREPACK_HOME="$TRUSTED_COREPACK_HOME"');
      expect(isolatedStep).toContain('COREPACK_ENABLE_NETWORK=0');
    }
    expect(workspace).toContain('COREPACK_ENABLE_NETWORK=0');
    expect(cleanup).toContain('TRUSTED_COREPACK_HOME');

    const capture = step('Capture candidate through trusted boundary');
    expect(capture).toContain('paths = sorted(tracked | candidate_paths)');
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
    expect(verification).not.toContain('docker compose');

    const compose = step(
      'Validate Compose configuration through trusted boundary',
    );
    expect(compose).toContain('docker compose');
    expect(compose).toContain('--file "$MODEL_WORKSPACE/compose.yaml"');
    expect(compose).toContain('--project-directory "$MODEL_WORKSPACE"');
    expect(compose).toContain('config --quiet');
    expect(compose).not.toContain('sudo -u opencode_model');
    expect(compose).not.toContain('${{ secrets.');
  });

  it('boots and probes Compose services in credential-free pull-request CI', () => {
    const runtimeJob = ciJob('compose_runtime');
    const validateJob = ciJob('validate');
    expect(validateJob).toContain('needs: compose_runtime');
    expect(runtimeJob).not.toContain('secrets.');
    expect(runtimeJob).not.toContain('GH_TOKEN');
    expect(runtimeJob).not.toContain('GITHUB_TOKEN');
    expect(runtimeJob).not.toMatch(/permissions:\s*\n\s+[^\n]+:\s*write/u);

    const runtime = namedStep(
      runtimeJob,
      'Start and probe Compose infrastructure',
    );
    expect(runtime).toContain(
      'docker compose up --detach --wait --wait-timeout 90',
    );
    expect(runtime).toContain(
      "docker compose exec --no-TTY postgres psql -U lifeos -d lifeos -v ON_ERROR_STOP=1 -tAc 'SELECT 1'",
    );
    expect(runtime).toContain('http://127.0.0.1:8222/jsz');
    expect(runtime).toContain('jq -e \'(.streams | type) == "number"');
    expect(runtime).toContain(
      'docker compose logs --no-color --timestamps --tail 200 postgres nats',
    );
    expect(runtime).toContain('docker compose down --volumes --remove-orphans');
    expect(compose).toMatch(
      /image: postgres:17\.10-alpine@sha256:[a-f0-9]{64}/u,
    );
    expect(compose).toMatch(/image: nats:2\.11\.6-alpine@sha256:[a-f0-9]{64}/u);
    expect(compose).toContain("'127.0.0.1:5432:5432'");
    expect(compose).toContain("'127.0.0.1:4222:4222'");
    expect(compose).toContain("'127.0.0.1:8222:8222'");
    expect(compose).not.toContain("- '5432:5432'");
    expect(compose).not.toContain("- '4222:4222'");
    expect(compose).not.toContain("- '8222:8222'");
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

    const ancestorPreflight = materialize.indexOf(
      'reject_symlinked_ancestors(target_path)',
    );
    expect(ancestorPreflight).toBeGreaterThanOrEqual(0);
    expect(ancestorPreflight).toBeLessThan(
      materialize.indexOf("if item['status'] == 'D':"),
    );
    expect(ancestorPreflight).toBeLessThan(
      materialize.indexOf('parent.mkdir(parents=True, exist_ok=True)'),
    );
    expect(materialize).toContain('if cursor == root:');
    expect(materialize).toContain('if root not in cursor.parents:');

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
    expect(mutation.match(/^\s*assert_live_lease$/gmu)).toHaveLength(2);
    expect(mutation.match(/git ls-remote/gu)).toHaveLength(2);
    expect(mutation.match(/timeout 30s git ls-remote/gu)).toHaveLength(2);
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

  it('marks bridge and provider validations skipped until their prerequisites run', () => {
    const receipt = step('Compose credential-free development receipt');

    expect(receipt).toContain(
      'MODEL_CATALOG_OUTCOME: ${{ steps.model_catalog.outcome }}',
    );
    expect(receipt).toContain(
      `{'name': 'model_catalog', 'status': 'skipped' if not selected or open_prs != '0' else 'passed' if model_catalog_outcome == 'success' else 'failed'}`,
    );
    expect(receipt).toContain(
      `{'name': 'credential_bridge', 'status': 'skipped' if not selected or open_prs != '0' or model_catalog_outcome != 'success' else 'passed' if bridge_reason == 'completed' else 'failed'}`,
    );
    expect(receipt).toContain(
      `{'name': 'provider_run', 'status': 'skipped' if not selected or open_prs != '0' or model_catalog_outcome != 'success' or bridge_reason != 'completed' else 'passed' if model_reason == 'completed' else 'failed'}`,
    );
    expect(receipt).toContain(
      `{'name': 'diff_policy', 'status': 'skipped' if not selected or open_prs != '0' or model_catalog_outcome != 'success' or bridge_reason != 'completed' or model_reason != 'completed' else 'passed' if diff_accepted else 'failed'}`,
    );
    expect(receipt).toContain(
      "status, reason = 'failed', 'invalid_configuration'",
    );
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
