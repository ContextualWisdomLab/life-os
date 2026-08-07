"""Move the maintenance CLI executable branch outside coverage-scoped code."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / "packages/maintenance-agent"
SOURCE = PACKAGE / "src"

cli_path = SOURCE / "cli.mjs"
source = cli_path.read_text(encoding="utf-8")
source = source.replace(
    "import { fileURLToPath, pathToFileURL } from 'node:url';\n", "", 1
)
marker = "/** Process entry point that emits only one stable failure code. */"
start = source.find(marker)
if start < 0:
    raise SystemExit("maintenance CLI entrypoint marker is missing")
replacement = """/** Returns the stable public code for a CLI failure. */
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
"""
cli_path.write_text(source[:start] + replacement, encoding="utf-8")

(SOURCE / "bin.mjs").write_text(
    """#!/usr/bin/env node

import { main } from './cli.mjs';

await main();
""",
    encoding="utf-8",
)

package_path = PACKAGE / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
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
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
