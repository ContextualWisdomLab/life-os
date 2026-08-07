"""Apply deterministic strict-TypeScript corrections to the privacy service."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PRIVACY = ROOT / "apps/privacy-service"


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    """Replace one exact source block or stop before ambiguous mutation."""

    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


def repair_context_headers() -> None:
    """Make the exact signed headers structurally compatible with the verifier."""

    path = PRIVACY / "src/privacy-service-context.ts"
    replace_once(
        path,
        """export interface PrivacyServiceContextHeaders {
  readonly 'x-life-os-context-key-id': string;
""",
        """export interface PrivacyServiceContextHeaders {
  readonly [headerName: string]: string;
  readonly 'x-life-os-context-key-id': string;
""",
        "privacy context header index signature",
    )


def repair_application_initialization() -> None:
    """Let strict property initialization observe the constructor's never path."""

    path = PRIVACY / "src/privacy-access-application.ts"
    replace_once(
        path,
        """    if (!dependencies || typeof dependencies !== 'object') {
      return invalid();
    }
""",
        """    if (!dependencies || typeof dependencies !== 'object') {
      invalid();
    }
""",
        "privacy application constructor guard",
    )


def repair_policy_typing() -> None:
    """Contextually type the immutable purpose matrix as reviewed policy rules."""

    path = PRIVACY / "src/privacy-access-domain.ts"
    source = path.read_text(encoding="utf-8")
    source = source.replace(
        "const POLICY_RULES = Object.freeze([",
        "const POLICY_RULES: readonly PolicyRule[] = Object.freeze([",
        1,
    )
    for old, new in (
        ("Object.freeze(['read', 'correct'])", "Object.freeze(['read', 'correct'] as const)"),
        ("Object.freeze(['read'])", "Object.freeze(['read'] as const)"),
        ("Object.freeze(['read', 'export'])", "Object.freeze(['read', 'export'] as const)"),
        ("Object.freeze(['identity_profile'])", "Object.freeze(['identity_profile'] as const)"),
    ):
        source = source.replace(old, new)
    path.write_text(source, encoding="utf-8")


def repair_pg_adapter() -> None:
    """Keep the generic repository seam while adapting node-postgres rows safely."""

    path = PRIVACY / "src/privacy-runtime.ts"
    replace_once(
        path,
        """    const result = await this.client.query<Row>(
      text,
      values === undefined ? undefined : [...values],
    );
    return { rows: result.rows };
""",
        """    const result = await this.client.query(
      text,
      values === undefined ? undefined : [...values],
    );
    return { rows: result.rows as Row[] };
""",
        "node-postgres generic adapter",
    )


def repair_lint_contract() -> None:
    """Keep SQL validated by migration tests rather than an unsupported formatter."""

    path = PRIVACY / "package.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    document["scripts"]["lint"] = document["scripts"]["lint"].replace(
        ' migrations/*.sql',
        "",
    )
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    """Apply every strict boundary correction in one deterministic pass."""

    repair_context_headers()
    repair_application_initialization()
    repair_policy_typing()
    repair_pg_adapter()
    repair_lint_contract()


if __name__ == "__main__":
    main()
