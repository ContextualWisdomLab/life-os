"""Apply deterministic formatting and coverage fixes for the maintenance slice."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / "packages/maintenance-agent"
SOURCE = PACKAGE / "src"


def read(path: Path) -> str:
    """Read one UTF-8 repository file."""

    return path.read_text(encoding="utf-8")


def write(path: Path, value: str) -> None:
    """Write one UTF-8 repository file."""

    path.write_text(value, encoding="utf-8")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    """Replace one exact block or stop before ambiguous mutation."""

    source = read(path)
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    write(path, source.replace(old, new, 1))


def repair_cli_entrypoint() -> None:
    """Move the executable branch outside the coverage-scoped CLI module."""

    cli = SOURCE / "cli.mjs"
    source = read(cli)
    source = source.replace(
        "import { fileURLToPath, pathToFileURL } from 'node:url';\n", "", 1
    )
    source = source.replace(
        """/** Process entry point that emits only one stable failure code. */
export async function main(argv = process.argv.slice(2)) {
  try {
    await runMaintenanceCli(argv);
  } catch (error) {
    const code =
      error instanceof MaintenanceCliError
        ? error.code
        : 'maintenance_cli_failed';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(fileURLToPath(pathToFileURL(resolve(process.argv[1])))).href
  : '';
if (invokedPath === import.meta.url) {
  await main();
}
""",
        """/** Returns the stable public code for a CLI failure. */
export function maintenanceCliErrorCode(error) {
  return error instanceof MaintenanceCliError
    ? error.code
    : 'maintenance_cli_failed';
}

/** Process entry point that emits only one stable failure code. */
export async function main(argv = process.argv.slice(2)) {
  try {
    await runMaintenanceCli(argv);
  } catch (error) {
    process.stderr.write(`${maintenanceCliErrorCode(error)}\n`);
    process.exitCode = 1;
  }
}
""",
        1,
    )
    write(cli, source)
    write(
        SOURCE / "bin.mjs",
        """#!/usr/bin/env node

import { main } from './cli.mjs';

await main();
""",
    )

    package_path = PACKAGE / "package.json"
    package = json.loads(read(package_path))
    package["scripts"]["build"] = (
        "node --check src/contract.mjs && node --check src/plan.mjs && "
        "node --check src/cli.mjs && node --check src/bin.mjs"
    )
    package["scripts"]["lint"] = package["scripts"]["lint"].replace(
        "node --check src/cli.mjs && prettier",
        "node --check src/cli.mjs && node --check src/bin.mjs && prettier",
    )
    package["scripts"]["typecheck"] = package["scripts"]["typecheck"].replace(
        "node --check src/cli.mjs",
        "node --check src/cli.mjs && node --check src/bin.mjs",
    )
    package["bin"]["life-os-maintenance-agent"] = "src/bin.mjs"
    write(package_path, json.dumps(package, indent=2) + "\n")


def repair_contract_tests() -> None:
    """Exercise duplicate-array and integer validation branches."""

    path = SOURCE / "contract.test.mjs"
    marker = """      input({ buyerGaps: [gap({ capabilityId: 'Invalid Gap' })] }),
"""
    insertion = """      input({
        pullRequests: [
          pullRequest({
            changedPaths: ['apps/web/', 'apps/web/'],
          }),
        ],
      }),
      input({
        buyerGaps: [gap(), gap()],
      }),
"""
    source = read(path)
    if source.count(marker) != 1:
        raise SystemExit("contract duplicate test marker changed")
    write(path, source.replace(marker, insertion + marker, 1))


def repair_plan_tests() -> None:
    """Exercise invalid integer and path-prefix branches."""

    path = SOURCE / "plan.test.mjs"
    marker = """      {
        ...base,
        steps: [{ ...base.steps[0], sequence: 2 }],
      },
"""
    insertion = marker + """      {
        ...base,
        steps: [{ ...base.steps[0], sequence: -1 }],
      },
      {
        ...base,
        steps: [{ ...base.steps[0], sequence: 1.5 }],
      },
"""
    source = read(path)
    if source.count(marker) != 1:
        raise SystemExit("plan integer test marker changed")
    write(path, source.replace(marker, insertion, 1))


def repair_cli_tests() -> None:
    """Exercise stable generic errors and cleanup-failure branches."""

    path = SOURCE / "cli.test.mjs"
    source = read(path)
    source = source.replace(
        """  main,
  MaintenanceCliError,
""",
        """  main,
  maintenanceCliErrorCode,
  MaintenanceCliError,
""",
        1,
    )
    marker = """    const writeFailure = memoryFileSystem();
    writeFailure.seam.writeFile = async () => {
      throw new Error('private disk failure');
    };
    await assert.rejects(
      publishText('/tmp/output', 'expected', writeFailure.seam, () => 'failure'),
      MaintenanceCliError,
    );
"""
    insertion = marker + """
    const cleanupFailure = memoryFileSystem();
    cleanupFailure.seam.writeFile = async () => {
      throw new Error('private disk failure');
    };
    cleanupFailure.seam.unlink = async () => {
      throw new Error('private cleanup failure');
    };
    await assert.rejects(
      publishText(
        '/tmp/output',
        'expected',
        cleanupFailure.seam,
        () => 'cleanup-failure',
      ),
      MaintenanceCliError,
    );
"""
    if source.count(marker) != 1:
        raise SystemExit("CLI cleanup test marker changed")
    source = source.replace(marker, insertion, 1)
    main_marker = """  it('emits only a stable code from the process entry point', async () => {
"""
    generic_test = """  it('maps known and unknown failures to stable public codes', () => {
    assert.equal(
      maintenanceCliErrorCode(new MaintenanceCliError('known_failure')),
      'known_failure',
    );
    assert.equal(
      maintenanceCliErrorCode(new Error('private detail')),
      'maintenance_cli_failed',
    );
  });

"""
    if source.count(main_marker) != 1:
        raise SystemExit("CLI stable error test marker changed")
    write(path, source.replace(main_marker, generic_test + main_marker, 1))


def repair_static_contract_tests() -> None:
    """Align YAML quoting and anchor external-action parsing."""

    opencode = SOURCE / "opencode-contract.test.mjs"
    source = read(opencode)
    source = source.replace(
        "/^    \\\"\\*\\\": deny$/mu",
        "/^    ['\\\"]\\*['\\\"]: deny$/mu",
    )
    source = source.replace(
        "/^    \\\"\\.maintenance-output\\/maintenance-plan\\.json\\\": allow$/mu",
        "/^    ['\\\"]\\.maintenance-output\\/maintenance-plan\\.json['\\\"]: allow$/mu",
    )
    source = source.replace(
        "/^    \\\"\\.maintenance-output\\/maintenance-plan\\.json\\\": allow$/gmu",
        "/^    ['\\\"]\\.maintenance-output\\/maintenance-plan\\.json['\\\"]: allow$/gmu",
    )
    write(opencode, source)

    workflow = SOURCE / "workflow-contract.test.mjs"
    source = read(workflow)
    source = source.replace(
        "/uses:\\s+([^\\s#]+)/gu",
        "/^\\s*uses:\\s+([^\\s#]+)/gmu",
        1,
    )
    write(workflow, source)


def main() -> None:
    """Apply every deterministic repair before package verification."""

    repair_cli_entrypoint()
    repair_contract_tests()
    repair_plan_tests()
    repair_cli_tests()
    repair_static_contract_tests()


if __name__ == "__main__":
    main()
