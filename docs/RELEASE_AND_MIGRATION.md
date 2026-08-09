# LifeOS Release, Migration, and Rollback Contract

**Baseline:** protected `main` at `5c87a7ec3568a4ce47b25cad843f1bc5be91b294`

## 1. Purpose

This document defines repository-wide release and change-management invariants. Exact deployment and backup commands remain in `docs/operations/production-deployment.md` and `docs/operations/backup-and-restore.md`.

A merged feature is not automatically a release. A passing old head is not release evidence for a newer head.

## 2. Change classes

| Class | Examples | Minimum evidence |
| --- | --- | --- |
| Documentation-only | canonical docs, runbook correction | links/status/evidence consistency; normal configured checks |
| Application-compatible | additive UI/domain logic without persistent schema change | tests, coverage, security, build, affected E2E |
| API/event contract | route/event/schema semantic change | old/new contract tests, versioning, consumer compatibility |
| Database migration | table/constraint/index/data transform | real prior-state migration test, compatibility/rollback or forward-fix plan |
| External integration | OAuth/calendar/model/plugin provider behavior | provider contract, timeout/retry/origin/credential tests |
| Deployment/runtime | image/config/probes/network/workload behavior | render/dry-run/rollout/rollback evidence |
| Destructive/data-rights | deletion, retention, bulk data transform | explicit authority, backup/recovery, partial failure, immutable audit evidence |
| Security/cryptography | keys, signatures, auth, privilege | threat-model update, negative/replay tests, rotation/recovery |

## 3. Versioning policy

Until release readiness is proven, buyer-visible work remains under `CHANGELOG.md` → `Unreleased`.

A version/tag/release is created only when:

- the exact protected-main commit is selected as the release candidate;
- all repository-required CI/security/review gates pass for that commit;
- package/container/install smoke tests pass where artifacts are distributed;
- migration/rollback or forward-fix compatibility is proven for changes since the prior release;
- backup/restore/recovery evidence is current where applicable;
- supported web accessibility/localization journeys pass;
- SBOM/provenance/reproducibility evidence required by release policy is produced;
- release notes match the actual integrated artifact.

Do not increment version solely to retrigger checks or because one PR merged.

## 4. Database migration contract

Every schema/data migration identifies:

1. owning service/schema;
2. exact starting supported state;
3. forward SQL/code transform;
4. constraints/indexes introduced or changed;
5. application compatibility window;
6. data volume/locking/timeout assumptions;
7. rollback or forward-fix decision;
8. backup/recovery prerequisites for destructive transformations;
9. real PostgreSQL migration tests;
10. operator-visible failure/recovery behavior.

### Expand/contract preference

For changes requiring mixed-version operation, prefer:

```text
expand schema
→ deploy readers/writers compatible with old + new
→ backfill/reconcile with idempotent evidence
→ switch authority
→ observe
→ contract obsolete schema only after no supported consumer depends on it
```

Avoid requiring every service to deploy simultaneously unless the release explicitly proves that atomic coupling.

## 5. Migration failure states

A migration may fail:

- before any change;
- after DDL but before backfill;
- during batch backfill;
- after data transform but before application rollout;
- after new application deploy with old schema still present;
- after contract/removal.

The migration plan must say which states are transactionally rolled back, forward-fixed, retried, or restored. “Run rollback” is not sufficient if PostgreSQL/app behavior cannot actually reverse the completed transformation safely.

## 6. Backup prerequisite

Before a destructive/high-risk production migration, the operator verifies the recovery tier appropriate to the risk.

Current upstream LifeOS proves logical PostgreSQL dump/restore behavior, including checksum and unsafe-target refusal. It does not prove PITR or a deployment-specific RPO/RTO. Operators requiring tighter recovery use rehearsed managed/PostgreSQL WAL/PITR outside the current upstream logical-dump tier.

## 7. API and event migration

Breaking public/internal semantics require a new version or compatibility adapter.

During a compatibility window:

- old version remains explicitly supported or fails predictably;
- producer/consumer tests cover both sides;
- event replay/at-least-once behavior is understood;
- unknown versions fail closed;
- removed fields/operations are not silently reinterpreted;
- client migration and removal conditions are documented.

See `docs/API_CONTRACTS.md`.

## 8. Key/credential migration

Key rotation is staged:

```text
introduce new key identifier
→ begin signing/encrypting with new active key
→ retain narrowly bounded previous-key verification/decryption where required
→ migrate/refresh dependent state
→ verify usage has moved
→ retire previous key
→ reject retired identifier immediately
```

Never overwrite a key in place while callers cannot distinguish old/new material. Provider credential migrations preserve account/tenant binding and revocation semantics.

## 9. Application rollout

A rollout must distinguish:

- health (process/runtime alive);
- readiness (safe to receive the service's production traffic);
- migration success;
- external provider availability;
- actual customer-journey success.

A green liveness probe alone is not release acceptance.

The Kubernetes reference uses bounded reviewed inputs, immutable image identity where configured, server-side validation/diff, protected production environment, and workload rollback verification according to its runbook.

## 10. Rollback semantics

### Application rollback

Restores a prior compatible application workload revision/image and verifies readiness.

### First-time workload rollback

May require deletion of the newly created workload followed by absence verification rather than “roll back” to a nonexistent prior revision.

### Database rollback

Not automatically implied by application rollback. Completed migrations may remain and require a compatible prior application or explicit reverse/forward-fix migration.

### External side effects

Calendar messages/notifications/provider writes are not automatically reversible. Provider operations must define compensation or explicitly state that reversal is not supported.

### Data erasure

Successful erasure cannot be “rolled back” by restoring user data casually. Backup retention/legal recovery requirements must be reconciled with deletion policy and user/operator expectations.

## 11. Release candidate verification order

1. freeze/select exact candidate commit;
2. verify dependency lock/artifact source;
3. run deterministic unit/integration/E2E/coverage;
4. run security/SAST/dependency/supply-chain gates;
5. run migration compatibility/recovery evidence;
6. build distributable artifacts/images;
7. smoke test installed/built artifacts outside source assumptions;
8. verify Compose/Kubernetes reference as applicable;
9. verify backup/restore and operator runbooks affected by the release;
10. run bounded live-provider conformance where required as release evidence, without making provider availability a fabricated deterministic pass;
11. verify SBOM/provenance/signing;
12. verify changelog/release notes/version;
13. create tag/release from the unchanged accepted commit;
14. verify published artifact digest/provenance and rollback path.

If the commit changes, exact-head evidence is reacquired.

## 12. Release failure / abort

Abort or defer the release when:

- candidate head moves unexpectedly;
- required check/review is absent/stale/failing;
- migration cannot be rehearsed or has an unresolved destructive ambiguity;
- backup/restore/provenance artifact cannot be verified;
- critical security finding remains;
- package/container smoke test differs from source-tree test result;
- operator docs would require undocumented/manual knowledge;
- release notes claim behavior not present in the artifact.

A release abort does not prevent continued branch/product work.

## 13. Emergency security release

An emergency release may reduce nonessential scope but does not permit fabricated checks, unreviewed secret leakage, stale-head publication, or an unsafe migration. Security fixes still preserve exact source/artifact identity, minimal review, regression evidence, provenance and operator remediation guidance.

## 14. Changelog contract

`CHANGELOG.md` records externally meaningful additions/fixes/security changes under `Unreleased` until release. It must not become an internal commit log or claim a release date/version not represented by an immutable tag/artifact.

## 15. Documentation update rule

A release/migration change updates all affected canonical layers:

- PRD for customer outcome/scope;
- TRD for shared runtime contract;
- Architecture/ADR for authority/ownership decisions;
- API/data/UML for contract/persistence flow;
- threat/privacy for security/data lifecycle;
- test/operability for acceptance/recovery;
- traceability and changelog for evidence/status.

Documentation-only completion does not replace executable migration/release evidence.
