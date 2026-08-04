"""Finalize AI gateway key-rotation documentation and capability evidence."""

from __future__ import annotations

import json
from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    """Replace one exact text block or fail before mutating the file."""

    file_path = Path(path)
    source = file_path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    file_path.write_text(source.replace(old, new, 1), encoding="utf-8")


def update_runtime_documentation() -> None:
    """Replace the obsolete single-secret runtime and rotation contracts."""

    readme_path = "apps/ai-service/migrations/README.md"
    replace_once(
        readme_path,
        """Every route requires a short-lived signed service context produced only after a trusted proxy authenticates a session and authorizes workspace membership. The headers are `x-life-os-workspace-id`, `x-life-os-actor-id`, `x-life-os-context-issued-at`, and `x-life-os-context-signature`. The HMAC-SHA-256 payload binds canonical workspace and actor UUIDv4 values to issuance time, uppercase HTTP method, and the exact `/v1/...` path. The shared `AI_GATEWAY_CONTEXT_SECRET` must contain 32–4096 UTF-8 bytes, remain server-only, and be identical in the trusted proxy and AI service.
""",
        """Every route requires a short-lived signed service context produced only after a trusted proxy authenticates a session and authorizes workspace membership. The headers are `x-life-os-context-key-id`, `x-life-os-workspace-id`, `x-life-os-actor-id`, `x-life-os-context-issued-at`, and `x-life-os-context-signature`. The version 2 HMAC-SHA-256 payload binds the case-sensitive key identifier, canonical workspace and actor UUIDv4 values, issuance time, uppercase HTTP method, and exact `/v1/...` path.

The trusted web boundary requires `AI_GATEWAY_ACTIVE_KEY_ID` and `AI_GATEWAY_ACTIVE_KEY_SECRET` and signs only with that pair. AI service requires the same active pair and may additionally receive the complete verification-only overlap pair `AI_GATEWAY_PREVIOUS_KEY_ID` and `AI_GATEWAY_PREVIOUS_KEY_SECRET`. Each secret must contain 32–4096 UTF-8 bytes, active and previous identifiers and secrets must be distinct, and all material remains server-only.
""",
        "runtime keyed context contract",
    )
    replace_once(
        readme_path,
        """## Secret rotation and rollback

This contract currently supports one active secret. Rotation requires a coordinated trusted-proxy and AI-service deployment; zero-downtime overlapping verification keys are deferred. If signer and verifier become incompatible, disable external AI proposal traffic rather than falling back to unsigned ownership headers. Secret compromise requires coordinated replacement, waiting at least the 60-second context lifetime before treating old tags as expired, and reviewing proposal/decision audit evidence for forged activity.
""",
        """## Secret rotation and rollback

LifeOS supports one active signing key and one bounded previous verification key. Follow `docs/operations/ai-gateway-key-rotation.md` to expand verifier configuration, switch the signer, retain the former active key only through the request-validity and deployment overlap window, and retire it by removing the previous pair. Unknown and retired identifiers fail closed immediately; the verifier never trials every configured secret. If signer and verifier become incompatible, disable external AI proposal traffic rather than falling back to unsigned ownership headers. Suspected compromise requires immediate revocation rather than a normal overlap.
""",
        "runtime rotation runbook",
    )
    replace_once(
        readme_path,
        "External model transport, prompt and context redaction, policy evaluation, model-quality evaluation, multi-secret rotation windows, asymmetric workload identity, and separately authorized action execution remain independent reviewed capabilities.",
        "External model transport, prompt and context redaction, policy evaluation, model-quality evaluation, asymmetric workload identity, and separately authorized action execution remain independent reviewed capabilities.",
        "deferred work update",
    )


def update_research_review() -> None:
    """Record the current final NIST baseline and newer public draft status."""

    research_path = "docs/research/2026-08-04-ai-gateway-key-rotation-standards.md"
    replace_once(
        research_path,
        """### Key lifecycle and bounded overlap

NIST SP 800-57 Part 1 Revision 5 treats cryptographic keys and their metadata as managed assets with defined lifecycle states, protection requirements, cryptoperiods, and accountability. The implementation therefore treats the identifier as protected key metadata, requires explicit active and previous roles, and documents deployment, activation, retirement, and emergency revocation.
""",
        """### Key lifecycle and bounded overlap

NIST SP 800-57 Part 1 Revision 5 remains the current final publication. NIST published Revision 6 as an Initial Public Draft in December 2025; its comment period closed in February 2026. LifeOS treats Revision 5 as the final normative baseline while tracking the newer draft's expanded keying-material storage and lifecycle direction so the implementation does not silently depend on draft status.

Revision 5 treats cryptographic keys and their metadata as managed assets with defined lifecycle states, protection requirements, cryptoperiods, and accountability. The implementation therefore treats the identifier as protected key metadata, requires explicit active and previous roles, and documents deployment, activation, retirement, and emergency revocation.
""",
        "current NIST publication status",
    )
    research_file = Path(research_path)
    research = research_file.read_text(encoding="utf-8")
    final_reference = "Barker, E. (2020). *Recommendation for key management: Part 1—General* (NIST Special Publication 800-57 Part 1 Revision 5). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-57pt1r5\n"
    draft_reference = "Barker, E., & Barker, W. (2025). *Recommendation for key management: Part 1—General* (Initial Public Draft, NIST Special Publication 800-57 Part 1 Revision 6). National Institute of Standards and Technology. https://csrc.nist.gov/pubs/sp/800/57/pt1/r6/ipd\n\n"
    if draft_reference.strip() not in research:
        if research.count(final_reference) != 1:
            raise SystemExit("NIST final reference insertion point was not unique")
        research = research.replace(
            final_reference,
            final_reference + "\n" + draft_reference,
            1,
        )
    research_file.write_text(research, encoding="utf-8")


def update_changelog() -> None:
    """Add the buyer-visible key-rotation security outcome to Unreleased."""

    path = Path("CHANGELOG.md")
    source = path.read_text(encoding="utf-8")
    heading = "### Security\n\n"
    entry = "- AI gateway service-context authentication now carries an integrity-protected key identifier, signs only with one active key, verifies one explicitly selected active or previous key during a bounded overlap, and rejects retired identifiers immediately without trial verification.\n"
    if entry.strip() not in source:
        if source.count(heading) != 1:
            raise SystemExit("CHANGELOG Security heading was not unique")
        source = source.replace(heading, heading + entry, 1)
    path.write_text(source, encoding="utf-8")


def update_capability_evidence() -> None:
    """Register implementation, integration, and runbook evidence."""

    path = Path("product/capabilities.json")
    document = json.loads(path.read_text(encoding="utf-8"))
    capability = next(
        (
            item
            for item in document["capabilities"]
            if item["id"] == "ai.auditable-proposals"
        ),
        None,
    )
    if capability is None:
        raise SystemExit("AI auditable proposal capability was not found")
    additions = [
        {
            "maturity": "usable",
            "kind": "implementation",
            "mode": "exists",
            "path": "apps/ai-service/src/ai-gateway-keyring.ts",
        },
        {
            "maturity": "production",
            "kind": "test",
            "mode": "exists",
            "path": "apps/ai-service/src/proposal-audit-http.integration.test.ts",
        },
        {
            "maturity": "production",
            "kind": "documentation",
            "mode": "exists",
            "path": "docs/operations/ai-gateway-key-rotation.md",
        },
    ]
    existing_paths = {item["path"] for item in capability["evidence"]}
    capability["evidence"].extend(
        item for item in additions if item["path"] not in existing_paths
    )
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def append_script_targets(package_path: str, script_name: str, targets: list[str]) -> None:
    """Append unique whitespace-delimited formatter targets to one package script."""

    path = Path(package_path)
    package = json.loads(path.read_text(encoding="utf-8"))
    command = package["scripts"][script_name]
    for target in targets:
        token = f" {target}"
        if token not in command:
            command += token
    package["scripts"][script_name] = command
    path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")


def update_formatting_contracts() -> None:
    """Put every new source and document under deterministic formatting checks."""

    append_script_targets(
        "apps/ai-service/package.json",
        "lint",
        [
            "migrations/README.md",
            "../../docs/operations/ai-gateway-key-rotation.md",
            "../../docs/research/2026-08-04-ai-gateway-key-rotation-standards.md",
            "../../docs/superpowers/specs/2026-08-04-ai-gateway-key-rotation-design.md",
            "../../docs/superpowers/plans/2026-08-04-ai-gateway-key-rotation.md",
        ],
    )
    append_script_targets(
        "package.json",
        "format:check",
        [
            "CHANGELOG.md",
            "apps/ai-service/src/ai-gateway-keyring.ts",
            "apps/ai-service/src/ai-gateway-keyring.test.ts",
            "apps/ai-service/src/ai-http-boundary.ts",
            "apps/ai-service/src/ai-http-boundary.test.ts",
            "docs/operations/ai-gateway-key-rotation.md",
            "docs/research/2026-08-04-ai-gateway-key-rotation-standards.md",
            "docs/superpowers/specs/2026-08-04-ai-gateway-key-rotation-design.md",
            "docs/superpowers/plans/2026-08-04-ai-gateway-key-rotation.md",
        ],
    )


def main() -> None:
    """Apply every finalization mutation in a fail-closed order."""

    update_runtime_documentation()
    update_research_review()
    update_changelog()
    update_capability_evidence()
    update_formatting_contracts()


if __name__ == "__main__":
    main()
