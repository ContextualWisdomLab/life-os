"""Correct exact maintenance coverage fixtures before generation."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / ".github/scripts/complete-maintenance-coverage.py"


def replace_once(source: str, old: str, new: str, label: str) -> str:
    """Replace one exact source fragment or stop before ambiguous mutation."""

    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return source.replace(old, new, 1)


def main() -> None:
    """Align generated tests with the production maintenance contract."""

    source = TARGET.read_text(encoding="utf-8")
    source = replace_once(
        source,
        """  contractDigest,
  MaintenanceContractError,
""",
        """  maintenanceContractDigest,
  MaintenanceContractError,
""",
        "contract digest import",
    )
    source = replace_once(
        source,
        "tampered.contractDigest = contractDigest(tampered);",
        "tampered.contractDigest = maintenanceContractDigest(tampered);",
        "contract digest call",
    )
    source = replace_once(
        source,
        "waitContract.target.number",
        "waitContract.target.externalNumber",
        "pull request target field",
    )
    source = replace_once(
        source,
        "                source: 'human',\n",
        "",
        "bounded finding keys",
    )
    source = replace_once(
        source,
        "            pathPrefixes: ['apps/web'],",
        "            pathPrefixes: ['apps/web/'],",
        "allowed plan path prefix",
    )
    TARGET.write_text(source, encoding="utf-8")


if __name__ == "__main__":
    main()
