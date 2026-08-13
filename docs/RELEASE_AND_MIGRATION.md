# LifeOS Release, Migration, Rollback, and Provenance

**Status:** Implemented on active PR

## Release rule

Release only from one unchanged exact protected integrated head after every applicable repository policy and product acceptance class passes together. Feature-branch, synthetic-only, queued, predecessor, or model evidence cannot authorize release.

## Required release evidence

- required exact-source CI and security checks plus independently classified compatibility evidence;
- zero actionable unresolved human/CodeRabbit/GHAS/Dependabot/OpenCode/Noema/Strix findings;
- exact configured production coverage and public-docstring gates;
- browser/accessibility/localization acceptance for affected journeys;
- package/container build and smoke evidence;
- migration compatibility, rollback/forward-fix, restart, and recovery evidence;
- backup/restore integrity and unsafe-target refusal where persistent state changes;
- SBOM, artifact attestation/provenance, reproducibility, dependency integrity, and publish verification required by policy;
- operator readiness, bounded telemetry, incident/recovery acceptance, and no production stub/fake-success path;
- version/CHANGELOG alignment with the exact artifact and source identity.

## Evidence identity

Release decisions retain separate:

- `source_head_sha`;
- `pr_base_snapshot_sha`;
- independently resolved `live_base_tip_sha`;
- integration/synthetic tree identity;
- `workflow_checkout_sha`;
- `protected_main_sha`;
- `release_source_sha`;
- artifact digest/provenance identity.

PR #154 protects local source/live-base separation. Issue #132 remains **Partial** for central reusable scanner taxonomy. A status is release evidence only for the tree and artifact it actually inspected.

## Service-owned schema migrations

Every service sequences its own migrations under its own role. Cross-service migrations and direct cross-schema mutation are prohibited. Migrations preserve UUIDv4, tenant scope, immutability, secret-reference, replay, concurrency, and recovery invariants.

For risky migrations:

1. add failing migration/compatibility/privilege/restart evidence where practical;
2. define exact preconditions and current data-shape assumptions;
3. stage additive columns/constraints/backfill/validation where required;
4. prove old/new application compatibility for rolling deployment claims;
5. define rollback or explicit forward-fix behavior;
6. prove retry/restart/duplicate/malformed/corrupt evidence handling;
7. verify backup/restore and retention interactions;
8. record irreversible effects and recovery limits.

## Active migration line

| Pull request | Status | Migration/release obligation |
| --- | --- | --- |
| PR #195 | Implemented on active PR | Review erasure receipt migration, owner privilege/replay/restart evidence |
| PR #198 | Implemented on active PR | Notification erasure migration, claims/outcome immutability, owner-only deletion/replay evidence |
| PR #199 | Implemented on active PR | AI erasure migration, append-only trigger authority, cursor compatibility, owner-only atomic deletion |
| PR #200 | Implemented on protected main | no product schema; exact pinned bootstrap and narrow lifecycle-script policy |

Active work cannot enter a release until integrated and revalidated on the final protected head.

## Application rollback

Application rollback restores only reversible application/configuration state. It never claims to undo committed database migrations, destructive erasure, delivered notifications/calendar mutations, provider revocations, or secret-store writes/deletes without a tested compensating contract.

When rollback would reintroduce a binary unable to understand additive durable fields, cursor semantics, receipt rows, one-time replay records, or current signature versions, forward-fix or staged compatibility is required instead.

## Data-rights migration and release

PR #159 protects the contributor contract. Planning PR #179/PR #194 and Habit PR #184/PR #192 are protected contributors/transports. Active Review/Notification/AI work remains non-shipped.

Issue #55 remains **Partial** until exact participant inventory, remaining owners, durable reconciliation/recovery, retention/legal hold, backup expiry, protected artifact streaming/encryption/expiry/deletion/download audit, and terminal whole-right receipt evidence pass on one protected head.

No release may claim complete export/deletion from partial or unknown participants.

## Calendar credential migration

Protected PR #150, PR #153, PR #155, PR #157, PR #176, PR #189, PR #193, PR #197, and PR #201 establish metadata, authority, disconnect, validation, read, materialization, creation, and mismatch-compensation foundations.

The process-global development token cannot be silently treated as hosted multi-user credentials. Issue #129 requires an explicit migration to a concrete encrypted KMS/secret store, OAuth/PKCE, refresh, provider cleanup, discovery/selection, scoped synchronization, rotation/recovery, and retirement of global production credentials. Rollback must preserve revoked authority and cannot resurrect deleted provider/KMS secrets.

## Plugin runtime migration

Protected PR #151, PR #169, PR #172, PR #175, PR #191, and PR #196 establish grants, durable installation, opaque secret binding, exact evidence, one-time operator replay, and fail-closed HTTP composition.

Issue #130 remains **Partial**. Future authorized-origin and delivery schemas/contracts must be explicit versions, must not infer network authority from old manifests/installations, and require concrete KMS, SSRF/DNS-rebinding-safe egress, outcomes, retries/dead-letter, revocation fencing, operator recovery, migration, and rollback evidence.

## Package and automation changes

Exact pinned development/review tooling is supply-chain-sensitive. Protected PR #200 allows only `opencode-ai`, preserves the exact pin, and keeps unrelated lifecycle scripts denied. A fresh protected scheduled run must still pass exact installation verification before release acceptance.

## Versioning and CHANGELOG

Keep unreleased behavior under `CHANGELOG.md` -> `Unreleased`. Create version, tag, release notes, packages/images, SBOM, and provenance only after the exact protected source passes release acceptance. Verify published artifact digests and installed/runtime behavior against recorded source/provenance before announcing release.

Documentation-only governance changes must not be described as shipped product capability. Conversely, protected behavior must not remain labeled active after integration.

## Recovery exercises

Release acceptance includes relevant backup/restore, migration failure, stale-write conflict, worker replay, provider outage, KMS partial failure, data-rights stuck participant, plugin secret cleanup, provenance mismatch, rollback, and forward-fix exercises. No fixed public RPO/RTO is claimed without measured deployment-specific evidence.
