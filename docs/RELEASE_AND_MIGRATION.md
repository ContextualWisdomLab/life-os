# LifeOS Release, Migration, Rollback, and Provenance

**Status:** Implemented on active PR

## Release rule

Release only from one unchanged exact protected integrated head after every applicable repository policy and product acceptance class passes together. Feature-branch, synthetic-only, queued, predecessor, or model evidence cannot authorize release.

Issue #210 is **Partial**. Active Draft #217 and stacked #236 narrow structural release-evidence and detached-signature verification, but neither is an immutable release and neither transfers ancestor checks to a later source identity.

## Required release evidence

- required exact-source CI and security checks plus independently classified compatibility evidence;
- zero actionable unresolved human/CodeRabbit/GHAS/Dependabot/OpenCode/Noema/Strix findings;
- exact configured production coverage and public-docstring gates;
- browser/accessibility/localization acceptance for affected journeys;
- package/container build and smoke evidence;
- migration compatibility, rollback/forward-fix, restart, and recovery evidence;
- backup/restore integrity and unsafe-target refusal where persistent state changes;
- version plus CHANGELOG plus immutable tag/package/release identity;
- SBOM, artifact attestation/provenance, detached signature verification, reproducibility, dependency integrity, and publish verification required by policy;
- trust-root distribution plus key custody/rotation/revocation evidence where signatures are relied upon;
- operator readiness, bounded telemetry, incident/recovery acceptance, and no production stub/fake-success path;
- installed/runtime artifact verification against the exact protected release source.

## Evidence identity

Release decisions retain separate:

- `source_head_sha`;
- `pr_base_snapshot_sha`;
- independently resolved `live_base_tip_sha`;
- integration/synthetic tree identity;
- `workflow_checkout_sha`;
- `protected_main_sha`;
- `release_source_sha`;
- artifact/checksum/SBOM/provenance/signature identities.

PR #154 protects local source/live-base separation. Issue #132 remains **Partial** for central reusable scanner taxonomy. A status is release evidence only for the tree and artifact it actually inspected. Self-retiring verification workflows may prove an exact parent and then delete only themselves through an ordinary descendant; that deletion does not convert the parent proof into unrelated descendant merge/release authority.

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

## Active migration and release line

| Pull request | Status | Migration/release obligation |
| --- | --- | --- |
| PR #195 | Implemented on protected main | Review-owned data-rights migration/contributor is shipped authority |
| PR #198 | Implemented on active PR | Notification erasure migration, claims/outcome immutability, owner-only deletion/replay evidence |
| PR #199 | Implemented on active PR | AI erasure migration, append-only trigger authority, cursor compatibility, owner-only atomic deletion |
| PR #200 | Implemented on protected main | no product schema; exact pinned OpenCode bootstrap and narrow lifecycle-script policy only |
| PR #216 | Implemented on active PR | hosted Calendar rejects deployment-global provider credential authority; no data migration by itself |
| PR #228 | Implemented on active PR | OAuth authorization-state/PKCE persistence semantics require eventual Calendar-owned PostgreSQL migration/runtime, expiry and cleanup acceptance |
| PR #235 | Implemented on active PR | Integration-owned PostgreSQL delivery-origin grant persistence and active-installation fencing |
| PR #242 | Implemented on active PR | Vault KV v2 adapter keeps provider plaintext outside LifeOS durable rows |
| PR #244 / #245 | Implemented on active PR | one Integration-owned PostgreSQL pool plus concrete hosted/default-entrypoint runtime; retained real-server ancestor acceptance is not current-head release authority |
| PR #250 | Implemented on active PR | signed delivery-origin operator application; exact route verification and full-suite runtime proof must complete before the temporary verifier retires |
| PR #217 | Implemented on active PR | machine-readable structural release-evidence index/validation |
| PR #236 | Implemented on active PR | detached Ed25519 release-evidence verification/operator CLI |

Active work cannot enter a release until integrated and revalidated on the final protected head.

## Application rollback

Application rollback restores only reversible application/configuration state. It never claims to undo committed database migrations, destructive erasure, delivered notifications/calendar mutations, provider revocations, Vault/secret-store writes/deletes, or externally published release artifacts without a tested compensating contract.

When rollback would reintroduce a binary unable to understand additive durable fields, OAuth-state semantics, delivery-origin grants, cursor semantics, receipt rows, one-time replay records, or current signature versions, forward-fix or staged compatibility is required instead.

## Data-rights migration and release

PR #159 protects the contributor contract. Planning PR #179/PR #194, Habit PR #184/PR #192, and Review PR #195 are protected contributors/transports. Notification #198 and AI #199 remain active.

Issue #55 remains **Partial** until exact participant inventory, remaining owners, durable reconciliation/recovery, retention/legal hold, backup expiry, protected artifact streaming/encryption/expiry/deletion/download audit, and terminal whole-right receipt evidence pass on one protected head.

No release may claim complete export/deletion from partial or unknown participants.

## Calendar credential migration

Protected PR #150, PR #153, PR #155, PR #157, PR #176, PR #189, PR #193, PR #197, PR #201 and PR #203 establish metadata, authority, disconnect, validation, read, materialization, creation/compensation and Calendar-owned encrypted self-hosted credential storage.

Active #216 prevents process-global Google/CalDAV values from becoming hosted user authority. Active #228 adds bounded one-time OAuth state/PKCE authority with opaque verifier handles. Issue #129 still requires hosted callback/token exchange, successful verifier cleanup, Calendar-owned PostgreSQL OAuth-state runtime, refresh fencing, provider revoke/delete recovery, discovery/selection, scoped synchronization and end-to-end secret/KMS lifecycle acceptance. Rollback must preserve revoked/consumed authority and cannot resurrect deleted provider/KMS secrets or consumed authorization state.

## Plugin runtime migration

Protected PR #151, PR #169, PR #172, PR #175, PR #191, and PR #196 establish grants, durable installation, opaque secret binding, exact evidence, one-time operator replay, and fail-closed HTTP composition.

The active #130 line adds host-owned origin identity (#205), Integration-owned PostgreSQL grant persistence/fencing (#235), credential/revocation hardening (#241), Vault KV v2 secret storage (#242), authenticated Vault/hosted PostgreSQL composition (#243/#244/#245), and signed delivery-origin operator application authority (#250). None of these may infer connect-time network authority from a stored manifest or origin.

Issue #130 remains **Partial** until an immutable released/versioned canonical egress contract supplies connect-time DNS/IP and rebinding enforcement, redirect/proxy policy, bounded response/time behavior, and LifeOS owns durable delivery attempts/outcomes, retry/dead-letter, revocation fencing and operator recovery. Rollback cannot restore revoked installation/grant/credential authority or reveal/re-materialize a deleted Vault secret without an explicit reviewed recovery contract.

## First-party buyer-journey release

Issue #209 is **Partial**. Active first-party BFF/workspace descendants begin with #214 and include durable Goals #229 and Weekly Review #234. No release may advertise the complete buyer journey until the final dependency-ordered head has real browser E2E for normal/loading/empty/error/permission/responsive/interaction states, keyboard/focus/reduced-motion/a11y, Figma/Storybook traceability, authoritative Review read projections, and KO/EN/JA/ZH/VI/ES/DE/FR translation-ledger/font/text-expansion acceptance.

## Package and model-automation changes

Exact pinned development/review tooling is supply-chain-sensitive. Protected PR #200 allows only the reviewed `opencode-ai` bootstrap lifecycle needed to materialize the exact executable; it does not grant direct model-provider routing authority.

Active #208 preserves exact OpenCode identity but routes model capability through contextual-orchestrator and virtual `orchestrator/free`. It cannot integrate or enter release evidence while the owner authentication/bootstrap contract is unrepaired or consumed from an unreleased mutable owner revision. The required order is owner RED → causal owner fix → immutable reviewed owner release → exact LifeOS consumer bump → hosted consumer acceptance. LifeOS does not copy mutable owner source or select a direct-provider fallback.

## Release-evidence active stack

Draft #217 validates a machine-readable exact release-evidence index and fails closed on malformed source/artifact/checksum/provenance/signature coverage and invalid nightly identity. Stacked Draft #236 adds detached Ed25519 verification and a bounded operator CLI. These are evidence-verification mechanisms, not publishing authority.

Before #210 can close, one exact protected `release_source_sha` must produce and verify:

1. source version and CHANGELOG identity;
2. immutable Git tag/release plus package/image identity;
3. checksums and SBOM bound to the actual retained artifacts;
4. provenance/attestation and detached signatures with explicit subject coverage;
5. distributed/verifiable trust roots and key lifecycle/custody evidence;
6. reproducible rebuild/compare evidence appropriate to the artifact class;
7. migration/upgrade/rollback/restore/recovery acceptance;
8. installed buyer-path/runtime verification;
9. exact protected-head CI/security/review/coverage/docstrings/accessibility/localization acceptance.

Ancestor GREEN, a structurally valid evidence index, or a signature verifier does not satisfy this denominator alone.

## Versioning and CHANGELOG

Keep unreleased behavior under `CHANGELOG.md` -> `Unreleased`. Create version, tag, release notes, packages/images, SBOM, provenance and detached signatures only after the exact protected source passes release acceptance. Verify published artifact digests and installed/runtime behavior against recorded source/provenance before announcing release.

Documentation-only governance changes must not be described as shipped product capability. Conversely, protected behavior must not remain labeled active after integration.

## Recovery exercises

Release acceptance includes relevant backup/restore, migration failure, stale-write conflict, worker replay, OAuth ceremony expiry/replay, provider outage, Vault/KMS partial failure, data-rights stuck participant, plugin secret cleanup, egress/delivery retry recovery, provenance/signature mismatch, trust-root/key-rotation failure, rollback, and forward-fix exercises. No fixed public RPO/RTO is claimed without measured deployment-specific evidence.
