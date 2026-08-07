"""Apply deterministic regression corrections after authorized-purpose wiring."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PRIVACY = ROOT / "apps/privacy-service"


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    """Replace one exact reviewed block or fail before ambiguous mutation."""

    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


def tighten_reason_bytes() -> None:
    """Keep the byte cap independent from the Unicode code-point cap."""

    path = PRIVACY / "src/privacy-access-domain.ts"
    replace_once(
        path,
        "const MAXIMUM_REASON_BYTES = 2_048;\n",
        "const MAXIMUM_REASON_BYTES = 1_024;\n",
        "independent reason byte cap",
    )


def align_token_fixture_policy() -> None:
    """Bind token mutation fixtures to the actual immutable policy revision."""

    path = PRIVACY / "src/privacy-access-coverage.test.ts"
    replace_once(
        path,
        """import {
  PrivacyAccessValidationError,
  evaluatePrivacyAccessRequest,
  type PrivacyAccessDecision,
} from './privacy-access-domain';
""",
        """import {
  PRIVACY_ACCESS_POLICY_DIGEST,
  PRIVACY_ACCESS_POLICY_REVISION_ID,
  PrivacyAccessValidationError,
  evaluatePrivacyAccessRequest,
  type PrivacyAccessDecision,
} from './privacy-access-domain';
""",
        "coverage policy imports",
    )
    replace_once(
        path,
        """    policyRevisionId: '7a25c6b5-9fd7-45f3-9bd9-180dbc668c92',
    policyDigest:
      '8a96ff5f4f4d2f18ba31f38b1db20f99afc1a9018a1a12cf6e230ddf47e7d106',
""",
        """    policyRevisionId: PRIVACY_ACCESS_POLICY_REVISION_ID,
    policyDigest: PRIVACY_ACCESS_POLICY_DIGEST,
""",
        "coverage policy fixture",
    )


def repair_domain_regressions() -> None:
    """Reach denial policy and Unicode canonicalization without TTL/length noise."""

    path = PRIVACY / "src/privacy-access-domain.test.ts"
    replace_once(
        path,
        """        resourceCategory,
        reason: 'A sufficiently detailed and bounded business reason.',
""",
        """        resourceCategory,
        requestedTtlSeconds: purpose === 'break_glass' ? 300 : 600,
        reason: 'A sufficiently detailed and bounded business reason.',
""",
        "break-glass denial TTL",
    )
    replace_once(
        path,
        """    const first = evaluate({ reason: '  지원\\t사례 Ａ-17 검토 완료.  ' });
    const second = evaluate({ reason: '지원 사례 A-17 검토 완료.' });
""",
        """    const first = evaluate({
      reason: '  지원\\t사례 Ａ-17 개인정보 접근 사유 검토를 완료했습니다.  ',
    });
    const second = evaluate({
      reason: '지원 사례 A-17 개인정보 접근 사유 검토를 완료했습니다.',
    });
""",
        "Unicode reason canonicalization fixture",
    )


def repair_deployment_count_contract() -> None:
    """Count the YAML key and both required-variable references explicitly."""

    path = PRIVACY / "src/privacy-deployment-contract.test.ts"
    source = path.read_text(encoding="utf-8")
    for variable in (
        "PRIVACY_GRANT_ACTIVE_KEY_SECRET",
        "PRIVACY_CONTEXT_ACTIVE_KEY_SECRET",
        "PRIVACY_AUDIT_DIGEST_KEY",
    ):
        old = f"expect(compose.match(/{variable}/gu)).toHaveLength(2);"
        new = f"expect(compose.match(/{variable}/gu)).toHaveLength(3);"
        count = source.count(old)
        if count != 1:
            raise SystemExit(
                f"deployment reference count for {variable}: expected one match, found {count}"
            )
        source = source.replace(old, new, 1)
    path.write_text(source, encoding="utf-8")


def main() -> None:
    """Apply all remaining privacy regressions in reviewed order."""

    tighten_reason_bytes()
    align_token_fixture_policy()
    repair_domain_regressions()
    repair_deployment_count_contract()


if __name__ == "__main__":
    main()
