# LifeOS Release, Migration, and Rollback

**Status:** Implemented on active PR

## Release rule

A merged feature is not automatically a release. Release only from one exact protected integrated head after all applicable repository policy and product acceptance evidence passes together.

## Required release evidence

- required CI and security scans;
- zero actionable unresolved review findings;
- configured exact production coverage/docstring gates;
- browser/accessibility/localization acceptance for affected journeys;
- package/container build and smoke evidence;
- migration compatibility and rollback/forward-fix evidence;
- backup/restore evidence where persistent state is affected;
- SBOM/provenance/reproducibility evidence required by repository policy;
- operator readiness/observability evidence;
- CHANGELOG/version alignment with the artifact.

## Schema migrations

Every owning service sequences its own migrations. Cross-service migrations are prohibited. Migrations must preserve the service's identifier, tenant, immutability and concurrency invariants.

For risky migrations:

1. establish a failing compatibility/migration test where practical;
2. define preconditions and data-shape assumptions;
3. stage constraints/backfill/validation when required for safe rollout;
4. verify old/new application compatibility where rolling deployment is supported;
5. define rollback or explicit forward-fix behavior;
6. prove restart/retry behavior and bounded diagnostics.

## Application rollback

Application rollback restores only application/configuration state that is actually reversible. It must not claim to undo already committed DB migrations, external provider revocations, delivered notifications/calendar mutations or deletion effects unless a tested compensating contract exists.

## Data-rights changes

Data-rights request/receipt migrations preserve request identity, tenant/requesting-user ownership, recent-auth provenance and immutable terminal evidence. Whole-product erasure/export completion remains governed by issue #55 until all domain participants and retention/backup-delivery semantics are complete.

## Calendar credential migration

The process-global development token may not be silently treated as a hosted multi-user credential model. Issue #129 requires an explicit migration path to per-user encrypted connection/refresh/revocation/selection semantics.

## Plugin runtime migration

Existing manifest/event validation remains backward-compatible unless a versioned contract states otherwise. Future installation/secrets/delivery under #130 must not grant authority to old validation-only manifests implicitly.

## Versioning and CHANGELOG

Keep buyer-visible unreleased work under `CHANGELOG.md` → `Unreleased`. Bump the product/package version and create release notes/tag only after the exact protected revision satisfies release acceptance. Published artifacts must be verified against recorded source/artifact identity.

## Recovery exercises

Backup/restore, migration failure, stale-write conflict, worker replay and provider outage exercises are product evidence. Do not publish fixed RPO/RTO claims without measured deployment-specific recovery evidence.