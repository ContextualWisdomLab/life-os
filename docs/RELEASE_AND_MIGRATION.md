# LifeOS Release, Migration and Rollback Contract

**Status:** Accepted architecture  
**Baseline:** protected `main` at `f4cae6d83eadb00019d2962a650c55c59a3349ae`

## 1. Release principle

A merged feature is not automatically a release. A stable LifeOS release is one exact protected integrated commit for which the required product, security, migration, recovery, packaging and review evidence passes together.

## 2. Release candidate evidence

A stable candidate must have all applicable:

- required CI on the exact source/integrated commit according to repository policy;
- AppGuardrail/Semgrep/security/dependency evidence;
- zero valid unresolved review/security findings;
- exact owned-code coverage gates;
- package/container build and smoke evidence;
- schema migration and compatibility evidence;
- backup/restore evidence appropriate to the release;
- browser buyer-journey, accessibility and localization acceptance;
- SBOM/provenance/reproducibility evidence required by current policy;
- release notes and `CHANGELOG.md` matching the artifact;
- canonical docs status reconciled to protected main.

Queued, stale, predecessor-head, synthetic-merge-only or unavailable evidence is not promoted to exact-head success.

## 3. Versioning

Versions change only when release evidence is genuinely ready. `Unreleased` remains the correct changelog location while integration work is active.

Breaking API/event/data semantics require explicit migration/versioning; they are not hidden inside a patch release.

## 4. Database migration contract

Every owning service controls its migrations. A schema change documents and tests:

1. exact predecessor schema assumptions;
2. forward migration;
3. compatibility window with application code where required;
4. constraint/backfill sequencing for existing data;
5. failure behavior and transaction boundary;
6. rollback or forward-fix strategy;
7. post-migration verification;
8. recovery interaction with backup/restore.

A migration being syntactically valid does not prove existing-data safety.

## 5. Staged constraints and existing data

When new constraints depend on backfilled/legacy rows, use a staged approach where PostgreSQL behavior requires it. Validate existing rows before finalizing the strongest constraint rather than creating a deployment-only failure path.

Authentication-age migration work on protected main is representative evidence for this discipline.

## 6. Application rollout

Preferred order is determined by contract compatibility, not by a global assumption. Where cross-service compatibility matters:

- add backward-compatible producer/consumer support first;
- deploy schema/contract changes in the safe order;
- observe bounded health/metrics;
- remove compatibility paths only in a later reviewed change after evidence shows they are unused.

## 7. Rollback

### Application rollback

May restore a prior application workload when its schema/provider assumptions remain compatible.

### Database rollback

Is not implied by application rollback. Irreversible/destructive migrations require an explicit forward-fix or restored-backup plan.

### External provider rollback

Calendar/plugin/identity/model side effects may require provider-specific compensation; Kubernetes Deployment rollback cannot reverse them.

## 8. Backup interaction

Before migration risk that can affect durable user state, operators must have recovery evidence appropriate to their objectives. The upstream logical backup tier verifies archive integrity and safe restore targets but does not claim PITR.

Restoring an old backup after user erasure/data-rights completion may require policy-driven reconciliation before normal operation.

## 9. Current maturity and live gaps

Protected main now includes the durable Today synchronization slice from PR #127; issue #121 is closed completed and commercial readiness no longer counts it as unresolved.

At this baseline:

- durable Today synchronization — `Implemented on protected main` through `f4cae6d83eadb00019d2962a650c55c59a3349ae`;
- PR #139 — calendar trusted workspace context — `Implemented on active PR`;
- issue #55 — complete data rights — `Partial` despite protected-main recent-auth/ledger foundations;
- issue #129 — per-user calendar credential lifecycle — `Partial`;
- issue #130 — plugin runtime delivery — `Planned`;
- issue #132 — exact source-head verification attribution — `Planned`.

## 10. Release failure cases

Do not release when any of the following applies:

- required check is queued/pending/failed/cancelled/absent/stale;
- exact tested commit cannot be identified;
- migration requires untested manual data surgery;
- buyer-critical active PR is being described as shipped;
- unresolved canonical buyer gaps are incorrectly rendered as zero due to capability maturity;
- backup/restore evidence required for the change is missing;
- required provider credentials/configuration are only development sentinels;
- SBOM/provenance/package artifact does not match the release commit;
- a valid review/security finding remains unresolved.

## 11. Changelog rule

`CHANGELOG.md` records buyer/operator-visible behavior. Internal refactoring without observable contract impact does not need inflated release language. Security-sensitive detail stays bounded until safe disclosure.

## 12. Release completion

After publish/deploy, verify the released artifact/tag/digest maps to the exact reviewed commit, update canonical documentation from `Unreleased`/active-PR state as appropriate, and retain the minimum operational/provenance evidence required for support and rollback.