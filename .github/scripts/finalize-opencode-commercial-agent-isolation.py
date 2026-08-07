"""Apply least-authority isolation to the persistent OpenCode development workflow."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / "packages/commercial-development-agent/src"
WORKFLOW = ROOT / ".github/workflows/opencode-commercial-development.yml"


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    """Replace one exact source block or fail before ambiguous mutation."""

    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


def protect_trusted_authority() -> None:
    """Make validator and policy paths permanently outside model write authority."""

    contracts = PACKAGE / "contracts.mjs"
    replace_once(
        contracts,
        "const UUID_V4_PATTERN =\n",
        "import { posix as pathPosix } from 'node:path';\n\nconst UUID_V4_PATTERN =\n",
        "contracts path import",
    )
    marker = """  return path;
}

/** Requires one exact LifeOS issue or pull-request URL. */
"""
    helper = """  return path;
}

/** Requires one normalized relative repository path. */
function requireRepositoryPath(value) {
  const path = requireString(value, { maximumBytes: 1_024 });
  if (
    path.startsWith('/') ||
    path.includes('\\\\') ||
    pathPosix.normalize(path) !== path
  ) {
    return invalid();
  }
  return path;
}

/** Requires one exact LifeOS issue or pull-request URL. */
"""
    replace_once(
        contracts,
        marker,
        helper,
        "repository path contract helper",
    )
    replace_once(
        contracts,
        """  const prohibitedExactPaths = Array.isArray(input.prohibited_exact_paths)
    ? input.prohibited_exact_paths.map(requireRootFile)
    : invalid();
""",
        """  const prohibitedExactPaths = Array.isArray(input.prohibited_exact_paths)
    ? input.prohibited_exact_paths.map(requireRepositoryPath)
    : invalid();
""",
        "nested prohibited exact path contract",
    )

    policy_path = ROOT / "product/opencode-commercial-development-policy.json"
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    authority_prefix = "packages/commercial-development-agent/"
    if authority_prefix not in policy["prohibited_path_prefixes"]:
        policy["prohibited_path_prefixes"].append(authority_prefix)
    authority_policy = "product/opencode-commercial-development-policy.json"
    if authority_policy not in policy["prohibited_exact_paths"]:
        policy["prohibited_exact_paths"].append(authority_policy)
    policy_path.write_text(
        json.dumps(policy, indent=2) + "\n",
        encoding="utf-8",
    )

    contracts_test = PACKAGE / "contracts.test.mjs"
    replace_once(
        contracts_test,
        """      'node_modules/',
    ],
""",
        """      'node_modules/',
      'packages/commercial-development-agent/',
    ],
""",
        "policy authority prefix fixture",
    )
    replace_once(
        contracts_test,
        """      'pnpm-workspace.yaml',
    ],
""",
        """      'pnpm-workspace.yaml',
      'product/opencode-commercial-development-policy.json',
    ],
""",
        "policy authority exact fixture",
    )
    replace_once(
        contracts_test,
        """    { ...policy(), prohibited_exact_paths: ['.github/workflows/x.yml'] },
""",
        """    { ...policy(), prohibited_exact_paths: ['/absolute/path'] },
    { ...policy(), prohibited_exact_paths: ['nested\\\\windows.yml'] },
    { ...policy(), prohibited_exact_paths: ['nested/../escape.yml'] },
""",
        "nested prohibited path negative fixtures",
    )

    diff_test = PACKAGE / "diff-validator.test.mjs"
    replace_once(
        diff_test,
        """    '.github/workflows/unsafe.yml',
    '.env',
""",
        """    '.github/workflows/unsafe.yml',
    'packages/commercial-development-agent/src/diff-validator.mjs',
    'product/opencode-commercial-development-policy.json',
    '.env',
""",
        "authority diff rejection fixtures",
    )


def isolate_model_execution() -> None:
    """Run model and candidate verification outside the trusted git checkout."""

    replace_once(
        WORKFLOW,
        """  RECEIPT_DIR: ${{ runner.temp }}/commercial-development
""",
        """  RECEIPT_DIR: ${{ runner.temp }}/commercial-development
  MODEL_WORKSPACE: ${{ runner.temp }}/commercial-development-workspace
  MODEL_HOME: ${{ runner.temp }}/commercial-development-home
""",
        "isolated workspace environment",
    )

    prepare_marker = """      - name: Build the policy-isolated prompt
"""
    prepare_step = """      - name: Prepare the credential-free isolated model workspace
        if: steps.branch.outcome == 'success'
        run: |
          set -Eeuo pipefail
          rm -rf "$MODEL_WORKSPACE" "$MODEL_HOME"
          install -d -m 0755 "$MODEL_WORKSPACE"
          git archive "$GITHUB_SHA" | tar -x -C "$MODEL_WORKSPACE"
          if [ -e "$MODEL_WORKSPACE/.git" ]; then
            echo '::error::The model workspace must not contain Git metadata.'
            exit 1
          fi
          (
            cd "$MODEL_WORKSPACE"
            pnpm install --offline --frozen-lockfile
          )
          sudo groupadd --system lifeos-opencode
          sudo useradd \
            --system \
            --no-create-home \
            --gid lifeos-opencode \
            --home-dir "$MODEL_HOME" \
            --shell /usr/sbin/nologin \
            lifeos-opencode
          sudo install \
            -d \
            -o lifeos-opencode \
            -g lifeos-opencode \
            -m 0700 \
            "$MODEL_HOME"
          sudo chown -R lifeos-opencode:lifeos-opencode "$MODEL_WORKSPACE"
          chmod -R go-w "$GITHUB_WORKSPACE"

"""
    replace_once(
        WORKFLOW,
        prepare_marker,
        prepare_step + prepare_marker,
        "isolated model workspace step",
    )

    old_model = """          export NVIDIA_API_KEY="$NVIDIA_NIM_API_KEY"
          unset NVIDIA_NIM_API_KEY
          private_home="$RECEIPT_DIR/opencode-home"
          install -d -m 0700 "$private_home"
          cat > "$RECEIPT_DIR/opencode.json" <<'JSON'
          {
            "$schema": "https://opencode.ai/config.json",
            "autoupdate": false,
            "share": "disabled"
          }
          JSON
          chmod 0600 "$RECEIPT_DIR/opencode.json"
          set +e
          HOME="$private_home" \
          OPENCODE_CONFIG="$RECEIPT_DIR/opencode.json" \
          timeout --signal=TERM --kill-after=30s 90m \
            pnpm --filter @life-os/commercial-development-agent exec \
              opencode run \
                --model "$OPENCODE_MODEL" \
                --format json \
                "$(cat "$RECEIPT_DIR/prompt.txt")" \
            > "$RECEIPT_DIR/opencode.log" 2>&1
          status=$?
          set -e
          chmod 0600 "$RECEIPT_DIR/opencode.log"
"""
    new_model = """          export NVIDIA_API_KEY="$NVIDIA_NIM_API_KEY"
          unset NVIDIA_NIM_API_KEY
          cat > "$RECEIPT_DIR/opencode.json" <<'JSON'
          {
            "$schema": "https://opencode.ai/config.json",
            "autoupdate": false,
            "share": "disabled"
          }
          JSON
          chmod 0600 "$RECEIPT_DIR/opencode.json"
          sudo install \
            -o lifeos-opencode \
            -g lifeos-opencode \
            -m 0600 \
            "$RECEIPT_DIR/opencode.json" \
            "$MODEL_HOME/opencode.json"
          sudo install \
            -o lifeos-opencode \
            -g lifeos-opencode \
            -m 0600 \
            "$RECEIPT_DIR/prompt.txt" \
            "$MODEL_HOME/prompt.txt"
          export MODEL_RUNNER_PATH="$PATH"
          set +e
          timeout --signal=TERM --kill-after=30s 90m \
            sudo \
              --preserve-env=NVIDIA_API_KEY,OPENCODE_MODEL,MODEL_WORKSPACE,MODEL_HOME,MODEL_RUNNER_PATH \
              -u lifeos-opencode \
              bash -c '
                set -Eeuo pipefail
                nim_key="$NVIDIA_API_KEY"
                model="$OPENCODE_MODEL"
                workspace="$MODEL_WORKSPACE"
                model_home="$MODEL_HOME"
                runner_path="$MODEL_RUNNER_PATH"
                for variable in $(compgen -e); do
                  unset "$variable" 2>/dev/null || true
                done
                export HOME="$model_home"
                export PATH="$runner_path"
                export NVIDIA_API_KEY="$nim_key"
                export OPENCODE_MODEL="$model"
                export OPENCODE_CONFIG="$model_home/opencode.json"
                cd "$workspace"
                exec pnpm --filter @life-os/commercial-development-agent exec \
                  opencode run \
                    --model "$OPENCODE_MODEL" \
                    --format json \
                    "$(cat "$HOME/prompt.txt")"
              ' \
            > "$RECEIPT_DIR/opencode.log" 2>&1
          status=$?
          sudo pkill -KILL -u lifeos-opencode >/dev/null 2>&1 || true
          set -e
          chmod 0600 "$RECEIPT_DIR/opencode.log"
"""
    replace_once(
        WORKFLOW,
        old_model,
        new_model,
        "isolated OpenCode process",
    )

    projector_imports = """          import pathlib
          import subprocess

          base = os.environ['GITHUB_SHA']
          root = pathlib.Path(os.environ['GITHUB_WORKSPACE'])
          receipt_dir = pathlib.Path(os.environ['RECEIPT_DIR'])

          def run(*args):
              return subprocess.check_output(args, cwd=root, timeout=30)
"""
    projector_replacement = """          import pathlib
          import stat
          import subprocess

          base = os.environ['GITHUB_SHA']
          root = pathlib.Path(os.environ['MODEL_WORKSPACE'])
          trusted_root = pathlib.Path(os.environ['GITHUB_WORKSPACE'])
          receipt_dir = pathlib.Path(os.environ['RECEIPT_DIR'])
          git_prefix = (
              'git',
              f"--git-dir={trusted_root / '.git'}",
              f'--work-tree={root}',
          )

          def run(*args):
              if not args or args[0] != 'git':
                  raise RuntimeError('candidate projection accepts git commands only')
              return subprocess.check_output(
                  (*git_prefix, *args[1:]),
                  cwd=trusted_root,
                  timeout=30,
              )
"""
    replace_once(
        WORKFLOW,
        projector_imports,
        projector_replacement,
        "trusted candidate projector",
    )

    object_block = """              target = root / path
              deleted = status == 'D'
              symlink = target.is_symlink() if not deleted else False
              submodule = staged_modes.get(path) == '160000'
              binary = False
              content = ''
              size = 0
              if not deleted:
                  metadata = target.lstat()
                  size = metadata.st_size
                  if not symlink and not submodule and size <= 1_048_576:
                      raw = target.read_bytes()
                      try:
                          content = raw.decode('utf-8', 'strict')
                      except UnicodeDecodeError:
                          binary = True
                  elif size > 1_048_576:
                      content = ''
"""
    object_replacement = """              target = root / path
              deleted = status == 'D'
              base_mode = staged_modes.get(path)
              symlink = base_mode == '120000' if deleted else False
              submodule = base_mode == '160000'
              binary = False
              content = ''
              size = 0
              if not deleted:
                  metadata = target.lstat()
                  regular = stat.S_ISREG(metadata.st_mode)
                  symlink = symlink or stat.S_ISLNK(metadata.st_mode)
                  size = metadata.st_size
                  if regular and not symlink and not submodule and size <= 1_048_576:
                      current_mode = (
                          '100755'
                          if stat.S_IMODE(metadata.st_mode) & 0o111
                          else '100644'
                      )
                      if (
                          base_mode in {'100644', '100755'}
                          and current_mode != base_mode
                      ) or (base_mode is None and current_mode != '100644'):
                          binary = True
                      raw = target.read_bytes()
                      try:
                          content = raw.decode('utf-8', 'strict')
                      except UnicodeDecodeError:
                          binary = True
                  elif not regular or size > 1_048_576:
                      binary = True
"""
    replace_once(
        WORKFLOW,
        object_block,
        object_replacement,
        "nonblocking repository object projection",
    )
    replace_once(
        WORKFLOW,
        """          pnpm --filter @life-os/commercial-development-agent exec \
            commercial-development-agent validate-diff \
""",
        """          node packages/commercial-development-agent/src/cli.mjs \
            validate-diff \
""",
        "trusted direct diff validator",
    )

    old_verification = """      - name: Verify the accepted repository change
        id: verification
        if: steps.diff.outputs.accepted == 'true'
        run: |
          set +e
          pnpm format:check && \
          pnpm lint && \
          pnpm typecheck && \
          pnpm test && \
          pnpm build && \
          docker compose config > /dev/null
          status=$?
          set -e
          if [ "$status" -eq 0 ]; then
            echo 'passed=true' >> "$GITHUB_OUTPUT"
          else
            echo 'passed=false' >> "$GITHUB_OUTPUT"
          fi

"""
    new_verification = """      - name: Verify the accepted repository change
        id: verification
        if: steps.diff.outputs.accepted == 'true'
        run: |
          set +e
          sudo \
            --preserve-env=MODEL_WORKSPACE,MODEL_HOME \
            -u lifeos-opencode \
            env -i \
              HOME="$MODEL_HOME" \
              PATH="$PATH" \
              MODEL_WORKSPACE="$MODEL_WORKSPACE" \
              bash -c '
                set -Eeuo pipefail
                cd "$MODEL_WORKSPACE"
                pnpm format:check && \
                pnpm lint && \
                pnpm typecheck && \
                pnpm test && \
                pnpm build && \
                docker compose config > /dev/null
              '
          status=$?
          sudo pkill -KILL -u lifeos-opencode >/dev/null 2>&1 || true
          set -e
          if [ "$status" -eq 0 ]; then
            echo 'passed=true' >> "$GITHUB_OUTPUT"
          else
            echo 'passed=false' >> "$GITHUB_OUTPUT"
          fi

      - name: Revalidate the exact verified candidate
        id: verified_diff
        if: steps.verification.outputs.passed == 'true'
        run: |
          set -Eeuo pipefail
          python3 - <<'PY'
          import json
          import os
          import pathlib
          import stat
          import subprocess

          base = os.environ['GITHUB_SHA']
          candidate = pathlib.Path(os.environ['MODEL_WORKSPACE'])
          trusted = pathlib.Path(os.environ['GITHUB_WORKSPACE'])
          evidence = json.loads(
              (pathlib.Path(os.environ['RECEIPT_DIR']) / 'diff.json').read_text(
                  encoding='utf-8',
              ),
          )
          git_prefix = (
              'git',
              f"--git-dir={trusted / '.git'}",
              f'--work-tree={candidate}',
          )

          def git(*args):
              return subprocess.check_output(
                  (*git_prefix, *args),
                  cwd=trusted,
                  timeout=30,
              )

          tracked_records = git(
              'diff',
              '--name-status',
              '-z',
              base,
              '--',
          ).split(b'\\0')
          changed_paths = set()
          index = 0
          while index < len(tracked_records) and tracked_records[index]:
              status_value = tracked_records[index].decode('ascii')
              index += 1
              if status_value.startswith(('R', 'C')):
                  index += 1
                  changed_paths.add(
                      tracked_records[index].decode('utf-8', 'strict'),
                  )
                  index += 1
              else:
                  changed_paths.add(
                      tracked_records[index].decode('utf-8', 'strict'),
                  )
                  index += 1
          changed_paths.update(
              value.decode('utf-8', 'strict')
              for value in git(
                  'ls-files',
                  '--others',
                  '--exclude-standard',
                  '-z',
              ).split(b'\\0')
              if value
          )
          expected_paths = {item['path'] for item in evidence['files']}
          if changed_paths != expected_paths:
              raise SystemExit('verified candidate changed its repository path set')

          staged_modes = {}
          for record in git('ls-files', '--stage', '-z').split(b'\\0'):
              if not record:
                  continue
              metadata, path = record.split(b'\\t', 1)
              staged_modes[path.decode('utf-8', 'strict')] = (
                  metadata.split(b' ', 1)[0].decode('ascii')
              )

          for item in evidence['files']:
              target = candidate / item['path']
              if item['status'] == 'D':
                  if os.path.lexists(target):
                      raise SystemExit('verified candidate restored a deleted path')
                  continue
              metadata = target.lstat()
              if not stat.S_ISREG(metadata.st_mode):
                  raise SystemExit('verified candidate contains a non-regular file')
              base_mode = staged_modes.get(item['path'])
              current_mode = (
                  '100755'
                  if stat.S_IMODE(metadata.st_mode) & 0o111
                  else '100644'
              )
              if (
                  base_mode in {'100644', '100755'}
                  and current_mode != base_mode
              ) or (base_mode is None and current_mode != '100644'):
                  raise SystemExit('verified candidate changed executable mode')
              raw = target.read_bytes()
              if (
                  len(raw) != item['bytes']
                  or raw.decode('utf-8', 'strict') != item['content']
              ):
                  raise SystemExit('verified candidate changed validated content')
          PY
          echo 'accepted=true' >> "$GITHUB_OUTPUT"

      - name: Materialize only the exact validated candidate files
        id: materialization
        if: steps.verified_diff.outputs.accepted == 'true'
        run: |
          set -Eeuo pipefail
          python3 - <<'PY'
          import json
          import os
          import pathlib
          import stat
          import subprocess
          import tempfile

          candidate = pathlib.Path(os.environ['MODEL_WORKSPACE'])
          trusted = pathlib.Path(os.environ['GITHUB_WORKSPACE'])
          evidence = json.loads(
              (pathlib.Path(os.environ['RECEIPT_DIR']) / 'diff.json').read_text(
                  encoding='utf-8',
              ),
          )

          def safe_parent(root, parts, create=False):
              current = root
              for part in parts:
                  current = current / part
                  if os.path.lexists(current):
                      if not stat.S_ISDIR(current.lstat().st_mode):
                          raise SystemExit('candidate path parent is not a directory')
                  elif create:
                      current.mkdir(mode=0o755)
                  else:
                      raise SystemExit('candidate path parent is missing')
              return current

          expected_paths = {item['path'] for item in evidence['files']}
          for item in evidence['files']:
              parts = pathlib.PurePosixPath(item['path']).parts
              source_parent = safe_parent(candidate, parts[:-1])
              trusted_parent = safe_parent(trusted, parts[:-1], create=True)
              source = source_parent / parts[-1]
              target = trusted_parent / parts[-1]
              if item['status'] == 'D':
                  if not os.path.lexists(target):
                      raise SystemExit('validated deletion target is missing')
                  if not stat.S_ISREG(target.lstat().st_mode):
                      raise SystemExit('validated deletion target is not regular')
                  target.unlink()
                  continue

              metadata = source.lstat()
              if not stat.S_ISREG(metadata.st_mode):
                  raise SystemExit('materialized candidate source is not regular')
              raw = source.read_bytes()
              if (
                  len(raw) != item['bytes']
                  or raw.decode('utf-8', 'strict') != item['content']
              ):
                  raise SystemExit('materialized candidate no longer matches evidence')

              if os.path.lexists(target):
                  target_metadata = target.lstat()
                  if not stat.S_ISREG(target_metadata.st_mode):
                      raise SystemExit('trusted target is not a regular file')
                  mode = stat.S_IMODE(target_metadata.st_mode)
                  source_mode = stat.S_IMODE(metadata.st_mode)
                  if source_mode != mode:
                      raise SystemExit('candidate mode differs from trusted mode')
              else:
                  source_mode = stat.S_IMODE(metadata.st_mode)
                  if source_mode & 0o111:
                      raise SystemExit('new executable files are outside authority')
                  mode = 0o644

              descriptor, temporary_name = tempfile.mkstemp(
                  prefix='.lifeos-materialize-',
                  dir=trusted_parent,
              )
              try:
                  with os.fdopen(descriptor, 'wb') as output:
                      output.write(raw)
                      output.flush()
                      os.fsync(output.fileno())
                  os.chmod(temporary_name, mode)
                  os.replace(temporary_name, target)
              finally:
                  if os.path.exists(temporary_name):
                      os.unlink(temporary_name)

          tracked = subprocess.check_output(
              ('git', 'diff', '--name-only', '-z', os.environ['GITHUB_SHA'], '--'),
              cwd=trusted,
              timeout=30,
          ).split(b'\\0')
          untracked = subprocess.check_output(
              ('git', 'ls-files', '--others', '--exclude-standard', '-z'),
              cwd=trusted,
              timeout=30,
          ).split(b'\\0')
          actual_paths = {
              value.decode('utf-8', 'strict')
              for value in (*tracked, *untracked)
              if value
          }
          if actual_paths != expected_paths:
              raise SystemExit('materialized trusted diff differs from validated candidate')
          PY
          echo 'accepted=true' >> "$GITHUB_OUTPUT"

"""
    replace_once(
        WORKFLOW,
        old_verification,
        new_verification,
        "isolated candidate verification and materialization",
    )

    replace_once(
        WORKFLOW,
        """      - name: Recheck the exact main base before remote mutation
        id: base
        if: steps.verification.outputs.passed == 'true'
""",
        """      - name: Recheck the exact main base before remote mutation
        id: base
        if: steps.materialization.outputs.accepted == 'true'
""",
        "exact-base condition after materialization",
    )

    replace_once(
        WORKFLOW,
        """          DIFF_ACCEPTED: ${{ steps.diff.outputs.accepted }}
          VERIFICATION_PASSED: ${{ steps.verification.outputs.passed }}
""",
        """          DIFF_ACCEPTED: ${{ steps.verified_diff.outputs.accepted }}
          VERIFICATION_PASSED: ${{ steps.materialization.outputs.accepted }}
""",
        "receipt trusted verification outputs",
    )

    cleanup_marker = """            "$RECEIPT_DIR/commercial-readiness.md" \
            "$RECEIPT_DIR/run.json"
"""
    cleanup_replacement = """            "$RECEIPT_DIR/commercial-readiness.md" \
            "$RECEIPT_DIR/run.json"
          sudo pkill -KILL -u lifeos-opencode >/dev/null 2>&1 || true
          sudo userdel lifeos-opencode >/dev/null 2>&1 || true
          sudo groupdel lifeos-opencode >/dev/null 2>&1 || true
          sudo rm -rf "$MODEL_WORKSPACE" "$MODEL_HOME"
"""
    replace_once(
        WORKFLOW,
        cleanup_marker,
        cleanup_replacement,
        "isolated workspace cleanup",
    )


def expand_workflow_regressions() -> None:
    """Assert that model code cannot mutate or execute inside trusted authority."""

    path = PACKAGE / "workflow-contract.test.mjs"

    replace_once(
        path,
        """    expect(workflow).toContain('timeout-minutes: 120');
  });
""",
        """    expect(workflow).toContain('timeout-minutes: 120');
    expect(workflow).toContain(
      'MODEL_WORKSPACE: ${{ runner.temp }}/commercial-development-workspace',
    );
    expect(workflow).toContain(
      'MODEL_HOME: ${{ runner.temp }}/commercial-development-home',
    );
  });
""",
        "isolated workspace environment test",
    )

    old_model_assertions = """    expect(model).toContain('opencode run');
    expect(model).toContain('timeout --signal=TERM --kill-after=30s 90m');
    expect(model).not.toContain('GITHUB_TOKEN');
"""
    new_model_assertions = """    expect(model).toContain('opencode run');
    expect(model).toContain('timeout --signal=TERM --kill-after=30s 90m');
    expect(model).toContain('-u lifeos-opencode');
    expect(model).toContain('cd "$workspace"');
    expect(model).toContain('for variable in $(compgen -e)');
    expect(model).not.toContain('GITHUB_TOKEN');
"""
    replace_once(
        path,
        old_model_assertions,
        new_model_assertions,
        "isolated model process test",
    )

    deterministic_marker = """    expect(step('Build the policy-isolated prompt')).toContain(
      'commercial-development-agent prompt',
    );
"""
    deterministic_replacement = """    const isolation = step(
      'Prepare the credential-free isolated model workspace',
    );
    expect(isolation).toContain('git archive "$GITHUB_SHA"');
    expect(isolation).toContain('$MODEL_WORKSPACE/.git');
    expect(isolation).toContain('pnpm install --offline --frozen-lockfile');
    expect(isolation).toContain('lifeos-opencode');
    expect(isolation).toContain('chmod -R go-w "$GITHUB_WORKSPACE"');
    expect(step('Build the policy-isolated prompt')).toContain(
      'commercial-development-agent prompt',
    );
"""
    replace_once(
        path,
        deterministic_marker,
        deterministic_replacement,
        "isolated workspace preparation assertions",
    )

    replace_once(
        path,
        """    const projection = step('Project and validate the working-tree diff');
    expect(projection).toContain('commercial-development-agent validate-diff');
    expect(projection).toContain('timeout=30');
""",
        """    const projection = step('Project and validate the working-tree diff');
    expect(projection).toContain("root = pathlib.Path(os.environ['MODEL_WORKSPACE'])");
    expect(projection).toContain("--git-dir={trusted_root / '.git'}");
    expect(projection).toContain(
      'node packages/commercial-development-agent/src/cli.mjs',
    );
    expect(projection).toContain('validate-diff');
    expect(projection).toContain('stat.S_ISREG');
    expect(projection).toContain('timeout=30');
    const verification = step('Verify the accepted repository change');
    expect(verification).toContain('-u lifeos-opencode');
    expect(verification).toContain('env -i');
    expect(verification).toContain('cd "$MODEL_WORKSPACE"');
    expect(verification).not.toContain('github.token');
    const revalidation = step('Revalidate the exact verified candidate');
    expect(revalidation).toContain('changed_paths != expected_paths');
    expect(revalidation).toContain('stat.S_ISREG');
    const materialization = step(
      'Materialize only the exact validated candidate files',
    );
    expect(materialization).toContain("evidence['files']");
    expect(materialization).toContain('actual_paths != expected_paths');
    expect(materialization).not.toContain('rsync');
""",
        "trusted post-model boundary assertions",
    )

    replace_once(
        path,
        """    const mutation = step('Commit, push, and open one draft pull request');
""",
        """    expect(step('Recheck the exact main base before remote mutation')).toContain(
      "steps.materialization.outputs.accepted == 'true'",
    );
    const mutation = step('Commit, push, and open one draft pull request');
""",
        "materialization before credentialed mutation assertion",
    )


def main() -> None:
    """Apply the full isolation repair after the existing bounded corrections."""

    protect_trusted_authority()
    isolate_model_execution()
    expand_workflow_regressions()


if __name__ == "__main__":
    main()
