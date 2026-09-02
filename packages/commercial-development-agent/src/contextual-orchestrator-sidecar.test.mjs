import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const SIDECAR_PATH = resolve(
  import.meta.dirname,
  '../../../scripts/ci/lifeos_contextual_orchestrator_sidecar.sh',
);
const ORCHESTRATOR_PIN_SHA = '045d17da5e2aea56a97e241ee158ab1628d78660';
const temporaryDirectories = [];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'lifeos-sidecar-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function executable(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  chmodSync(path, 0o755);
}

function fakeToolchain(root) {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });

  executable(
    join(bin, 'git'),
    `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ \"\${1:-}\" == clone ]]; then
  destination=\"\${!#}\"
  mkdir -p \"$destination\"
  : > \"$destination/requirements.lock\"
  exit 0
fi
if [[ \"\${1:-}\" == -C && \"\${3:-}\" == checkout ]]; then
  exit 0
fi
if [[ \"\${1:-}\" == -C && \"\${3:-}\" == rev-parse ]]; then
  printf '%s\\n' '${ORCHESTRATOR_PIN_SHA}'
  exit 0
fi
echo 'unexpected fake git invocation' >&2
exit 97
`,
  );

  executable(
    join(bin, 'python3'),
    `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ \"\${1:-}\" != -m || \"\${2:-}\" != venv || -z \"\${3:-}\" ]]; then
  echo 'unexpected fake python3 invocation' >&2
  exit 98
fi
mkdir -p \"$3/bin\"
cat > \"$3/bin/python\" <<'PY'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ \"\${1:-}\" == -m && \"\${2:-}\" == pip ]]; then
  exit 0
fi
printf '%s\\n' \"$@\" > \"\${SIDECAR_CAPTURE_FILE:?SIDECAR_CAPTURE_FILE is required}\"
PY
chmod 0755 \"$3/bin/python\"
`,
  );

  return bin;
}

function runSidecar({ providerCredential = 'test-provider-key', port = '8000' } = {}) {
  const root = temporaryDirectory();
  const capture = join(root, 'gateway-arguments.txt');
  const bin = fakeToolchain(root);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    RUNNER_TEMP: root,
    LIFEOS_ORCHESTRATOR_SIDECAR_ROOT: join(root, 'sidecar'),
    LIFEOS_ORCHESTRATOR_GATEWAY_PORT: port,
    CONTEXTUAL_ORCHESTRATOR_TOKEN: 'test-gateway-token',
    SIDECAR_CAPTURE_FILE: capture,
  };
  if (providerCredential !== null) env.BYTEZ_API_KEY = providerCredential;
  for (const name of [
    'NVIDIA_NIM_API_KEY',
    'NVIDIA_NIM_API_KEY_SUB',
    'OPENROUTER_API_KEY',
    'OPENAI_API_KEY',
  ]) {
    delete env[name];
  }

  return {
    capture,
    result: spawnSync('/bin/bash', [SIDECAR_PATH], {
      encoding: 'utf8',
      env,
    }),
  };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe('contextual-orchestrator sidecar bootstrap', () => {
  it('normalizes a leading-zero decimal port before arithmetic and gateway startup', () => {
    const { capture, result } = runSidecar({ port: '08000' });

    expect(result.status, result.stderr).toBe(0);
    const argumentsText = readFileSync(capture, 'utf8');
    expect(argumentsText).toContain('--port\n8000\n');
    expect(argumentsText).toContain('--auth-token-key\nCONTEXTUAL_ORCHESTRATOR_TOKEN\n');
  });

  it('fails with a credential-free diagnostic when no governed provider credential exists', () => {
    const { result } = runSidecar({ providerCredential: null });

    expect(result.status).toBe(78);
    expect(result.stderr).toContain(
      'contextual-orchestrator bootstrap requires at least one governed provider credential',
    );
    expect(result.stderr).not.toContain('test-gateway-token');
  });
});
