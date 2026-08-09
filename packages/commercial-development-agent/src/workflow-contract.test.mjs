import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
        const loopbackProbeValue = modelLabel;
        expect(loopbackProbeValue).not.toHaveLength(0);
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
                apiKey: loopbackProbeValue,
              },
            },
          },
        });
        const configPath = resolve(directories.home, 'opencode.json');
        writeFileSync(configPath, config, { mode: 0o600 });

        const result = spawnSync(
          'pnpm',
          [
            '--filter',
            '@life-os/commercial-development-agent',
            'exec',
            'opencode',
            'models',
            'nvidia',
          ],
          {
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
              OPENCODE_CONFIG: configPath,
              OPENCODE_DISABLE_AUTOUPDATE: 'true',
              OPENCODE_DISABLE_MODELS_FETCH: 'true',
              OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
              NVIDIA_API_KEY: loopbackProbeValue,
            },
          },
        );

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
    expect(workspace).not.toContain('git config');
    expect(workspace).not.toContain('GITHUB_TOKEN');
    expect(workspace).not.toContain('GH_TOKEN');
    expect(workspace).not.toContain('${{ secrets.');

    const model = step('Run one bounded OpenCode implementation');
    expect(model).not.toContain('.git');
    expect(model).not.toContain('git ');
    expect(model).not.toContain('gh ');
    expect(model).not.toContain('GITHUB_TOKEN');
    expect(model).not.toContain('GH_TOKEN');
    expect(model).not.toContain('DOCKER_HOST');
    expect(model).not.toContain('/var/run/docker.sock');

    const verifier = step('Validate candidate before privileged mutation');
    expect(verifier).toContain('validate-candidate');
    expect(verifier).toContain('--base-sha "$BASE_SHA"');
    expect(verifier).toContain('--model-workspace "$MODEL_WORKSPACE"');
    expect(verifier).toContain('--trusted-root "$GITHUB_WORKSPACE"');
    expect(verifier).toContain('--policy product/opencode-commercial-development-policy.json');
    expect(verifier).toContain('--run-checks');
    expect(verifier).not.toContain('NVIDIA_NIM_API_KEY');
    expect(verifier).not.toContain('GITHUB_TOKEN');
    expect(verifier).not.toContain('GH_TOKEN');
  });

  it('keeps Compose authority outside the model sandbox and validates the exact accepted candidate', () => {
    const model = step('Run one bounded OpenCode implementation');
    expect(model).not.toContain('docker');
    expect(model).not.toContain('DOCKER_HOST');
    expect(model).not.toContain('/var/run/docker.sock');

    const composeValidation = step('Validate accepted Compose candidate');
    expect(composeValidation).toContain('selected_compose_file="$MODEL_WORKSPACE/compose.yaml"');
    expect(composeValidation).toContain('test -f "$selected_compose_file"');
    expect(composeValidation).toContain('docker compose');
    expect(composeValidation).toContain('--file "$selected_compose_file"');
    expect(composeValidation).toContain('config --quiet');
    expect(composeValidation).not.toContain('NVIDIA_NIM_API_KEY');
    expect(composeValidation).not.toContain('${{ secrets.');
  });

  it('keeps pull-request Compose runtime validation credential-free and ephemeral', () => {
    const composeRuntime = ciJob('compose_runtime');
    expect(composeRuntime).toContain('permissions:');
    expect(composeRuntime).toContain('contents: read');
    expect(composeRuntime).not.toContain('secrets.');
    expect(composeRuntime).toContain('POSTGRES_USER=postgres');
    expect(composeRuntime).toContain('POSTGRES_PASSWORD=postgres');
    expect(composeRuntime).toContain('127.0.0.1:55432:5432');
    expect(composeRuntime).toContain('127.0.0.1:54222:4222');
    expect(composeRuntime).toContain('127.0.0.1:58222:8222');
    expect(composeRuntime).toContain('docker compose');
    expect(composeRuntime).toContain('up --detach postgres nats');
    expect(composeRuntime).toContain('pg_isready');
    expect(composeRuntime).toContain('SELECT 1');
    expect(composeRuntime).toContain('/jsz');
    expect(composeRuntime).toContain('down --volumes --remove-orphans');
  });

  it('keeps the model-selected change set within one reviewable bounded slice', () => {
    const policy = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          '../../../product/opencode-commercial-development-policy.json',
        ),
        'utf8',
      ),
    );
    expect(policy.max_changed_files).toBeGreaterThan(0);
    expect(policy.max_changed_files).toBeLessThanOrEqual(20);
    expect(policy.max_patch_bytes).toBeGreaterThan(0);
    expect(policy.max_patch_bytes).toBeLessThanOrEqual(256 * 1024);
  });

  it('validates model-selected diffs before tests and records only approved evidence', () => {
    const validation = step('Validate candidate before privileged mutation');
    expect(validation).toContain('--model-workspace "$MODEL_WORKSPACE"');
    expect(validation).toContain('--trusted-root "$GITHUB_WORKSPACE"');
    expect(validation).toContain('--base-sha "$BASE_SHA"');
    expect(validation).toContain('--issue-snapshot "$RECEIPT_DIR/selected-issue.json"');
    expect(validation).toContain('--run-checks');
    expect(validation).not.toContain('NVIDIA_NIM_API_KEY');

    const acceptance = step('Revalidate accepted candidate');
    expect(acceptance).toContain('verify-receipt');
    expect(acceptance).toContain('--accepted-workspace "$MODEL_WORKSPACE"');
    expect(acceptance).toContain('--trusted-root "$GITHUB_WORKSPACE"');
    expect(acceptance).not.toContain('NVIDIA_NIM_API_KEY');
  });

  it('uses only credential-free immutable receipts for later privileged publication', () => {
    const receipt = step('Prepare immutable accepted receipt');
    expect(receipt).toContain('accepted-receipt.json');
    expect(receipt).toContain('chmod 0400 "$receipt_path"');
    expect(receipt).not.toContain('NVIDIA_NIM_API_KEY');
    expect(receipt).not.toContain('GITHUB_TOKEN');
    expect(receipt).not.toContain('GH_TOKEN');

    const publish = step('Publish bounded draft pull request');
    expect(publish).toContain('accepted-receipt.json');
    expect(publish).toContain('git checkout -b');
    expect(publish).toContain('gh pr create --draft');
    expect(publish).not.toContain('NVIDIA_NIM_API_KEY');
    expect(publish).not.toContain('OPENCODE');
  });
});
