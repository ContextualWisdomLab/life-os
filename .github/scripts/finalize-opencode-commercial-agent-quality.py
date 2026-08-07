"""Apply test-first least-authority hardening to the commercial agent."""

from __future__ import annotations

import argparse
import base64
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / "packages/commercial-development-agent/src"
WORKFLOW = ROOT / ".github/workflows/opencode-commercial-development.yml"


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    """Replace one exact block or fail before ambiguous mutation."""

    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


def replace_section(
    path: Path,
    start_marker: str,
    end_marker: str,
    replacement: str,
    label: str,
) -> None:
    """Replace one section delimited by unique exact markers."""

    source = path.read_text(encoding="utf-8")
    if source.count(start_marker) != 1 or source.count(end_marker) != 1:
        raise SystemExit(f"{label}: expected unique section markers")
    start = source.index(start_marker)
    end = source.index(end_marker, start)
    path.write_text(
        source[:start] + replacement + source[end:],
        encoding="utf-8",
    )


def add_hardening_tests() -> None:
    """Define nested-path, credential-broker, and resource-limit regressions."""

    diff_test = PACKAGE / "diff-validator.test.mjs"
    replace_once(
        diff_test,
        """    'packages/example/Cargo.toml',
    'unallowlisted-root.txt',
""",
        """    'packages/example/Cargo.toml',
    'apps/planning-service/.git/config',
    'apps/planning-service/.github/workflows/unsafe.yml',
    'apps/planning-service/node_modules/pkg/index.js',
    'apps/planning-service/coverage/summary.json',
    'apps/planning-service/dist/server.js',
    'apps/planning-service/build/output.js',
    'apps/planning-service/.next/server.js',
    'apps/planning-service/.turbo/cache.json',
    'apps/planning-service/.cache/result.json',
    'apps/planning-service/.env',
    'apps/planning-service/.npmrc',
    'apps/planning-service/.gitmodules',
    'unallowlisted-root.txt',
""",
        "nested protected path fixtures",
    )

    workflow_test = PACKAGE / "workflow-contract.test.mjs"
    replace_once(
        workflow_test,
        """    expect(model).toContain('-u lifeos-opencode');
    expect(model).toContain('cd \"$workspace\"');
    expect(model).toContain('for variable in $(compgen -e)');
""",
        """    expect(model).toContain('-u lifeos-opencode');
    expect(model).toContain('cd \"$workspace\"');
    expect(model).toContain('for variable in $(compgen -e)');
    expect(model).toContain('nim-broker.mjs');
    expect(model).toContain('https://integrate.api.nvidia.com');
    expect(model).toContain("requestUrl.pathname !== '/v1/chat/completions'");
    expect(model).toContain('body.model !== allowedModel');
    expect(model).toContain('\"baseURL\": \"http://127.0.0.1:');
    expect(model).toContain('\"apiKey\": \"lifeos-nim-broker\"');
    expect(model).toContain('unset NVIDIA_NIM_API_KEY');
    expect(model).toContain('ulimit -u 256');
    expect(model).toContain('ulimit -n 512');
    expect(model).toContain('ulimit -v 6291456');
    expect(model).toContain('ulimit -t 5400');
    const child = model.slice(
      model.indexOf('sudo \\\\'),
      model.indexOf('> \"$RECEIPT_DIR/opencode.log\"'),
    );
    expect(child).not.toContain('NVIDIA_NIM_API_KEY');
""",
        "broker and model resource assertions",
    )
    replace_once(
        workflow_test,
        """    expect(verification).toContain('env -i');
    expect(verification).toContain('cd \"$MODEL_WORKSPACE\"');
    expect(verification).not.toContain('github.token');
""",
        """    expect(verification).toContain('env -i');
    expect(verification).toContain('cd \"$MODEL_WORKSPACE\"');
    expect(verification).toContain('ulimit -u 256');
    expect(verification).toContain('ulimit -f 524288');
    expect(verification).toContain('ulimit -v 6291456');
    expect(verification).not.toContain('github.token');
""",
        "verification resource assertions",
    )


def harden_diff_paths() -> None:
    """Reject protected metadata and generated segments at every depth."""

    path = PACKAGE / "diff-validator.mjs"
    replace_once(
        path,
        """  'Gemfile.lock',
]);
const DOCUMENTATION_EXTENSIONS = new Set([
""",
        """  'Gemfile.lock',
  '.gitmodules',
  '.npmrc',
  '.pnpmfile.cjs',
  '.yarnrc',
  '.yarnrc.yml',
]);
const PROHIBITED_PATH_SEGMENTS = new Set([
  '.git',
  '.github',
  '.next',
  '.turbo',
  '.cache',
  'node_modules',
  'coverage',
  'dist',
  'build',
]);
const PROHIBITED_FILE_NAMES = new Set(['.env', '.env.example']);
const DOCUMENTATION_EXTENSIONS = new Set([
""",
        "nested protected path constants",
    )
    replace_once(
        path,
        """  const basename = pathPosix.basename(path);
  if (DEPENDENCY_FILE_NAMES.has(basename)) {
    return false;
  }
""",
        """  const segments = path.split('/');
  const basename = pathPosix.basename(path);
  if (
    segments.some((segment) => PROHIBITED_PATH_SEGMENTS.has(segment)) ||
    PROHIBITED_FILE_NAMES.has(basename) ||
    DEPENDENCY_FILE_NAMES.has(basename)
  ) {
    return false;
  }
""",
        "nested protected path enforcement",
    )


BROKERED_MODEL_BODY = zlib.decompress(
    base64.b64decode(
        "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",
    ),
).decode("utf-8")


def harden_model_execution() -> None:
    """Broker the NIM credential and cap untrusted process resources."""

    replace_section(
        WORKFLOW,
        '          export NVIDIA_API_KEY="$NVIDIA_NIM_API_KEY"\n',
        '          if [ "$status" -eq 0 ]; then\n',
        BROKERED_MODEL_BODY,
        "credential-brokered OpenCode execution",
    )
    replace_once(
        WORKFLOW,
        """                set -Eeuo pipefail
                cd "$MODEL_WORKSPACE"
                pnpm format:check && \\
""",
        """                set -Eeuo pipefail
                ulimit -c 0
                ulimit -u 256
                ulimit -n 512
                ulimit -f 524288
                ulimit -v 6291456
                ulimit -t 5400
                cd "$MODEL_WORKSPACE"
                pnpm format:check && \\
""",
        "candidate verification resource limits",
    )
    replace_once(
        WORKFLOW,
        """            "$RECEIPT_DIR/commercial-readiness.md" \\
            "$RECEIPT_DIR/run.json"
          sudo pkill -KILL -u lifeos-opencode >/dev/null 2>&1 || true
""",
        """            "$RECEIPT_DIR/commercial-readiness.md" \\
            "$RECEIPT_DIR/nim-broker.mjs" \\
            "$RECEIPT_DIR/nim-broker.log" \\
            "$RECEIPT_DIR/nim-broker.port" \\
            "$RECEIPT_DIR/nim-broker.pid" \\
            "$RECEIPT_DIR/run.json"
          sudo pkill -KILL -u lifeos-opencode >/dev/null 2>&1 || true
""",
        "credential broker cleanup",
    )


def remove_stale_import() -> None:
    """Remove the last stale quality-only import after tests define behavior."""

    path = PACKAGE / "exhaustive-coverage.test.mjs"
    replace_once(
        path,
        "  normalizeCommercialDevelopmentPolicy,\n",
        "",
        "stale normalizeCommercialDevelopmentPolicy import",
    )


def apply_implementation() -> None:
    """Apply the least-authority implementation after regression definition."""

    harden_diff_paths()
    harden_model_execution()
    remove_stale_import()


def main() -> None:
    """Apply one explicit test-first hardening phase."""

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "phase",
        choices=("tests", "implementation", "all"),
        nargs="?",
        default="all",
    )
    phase = parser.parse_args().phase
    if phase in {"tests", "all"}:
        add_hardening_tests()
    if phase in {"implementation", "all"}:
        apply_implementation()


if __name__ == "__main__":
    main()
