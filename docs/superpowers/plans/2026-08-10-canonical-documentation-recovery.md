# Canonical Documentation Recovery Plan

**Date:** 2026-08-10  
**Source baseline:** protected `main` `2cd8c766d2c8358936eac1f92e44c8e9f99f1fea`  
**Successor branch:** `docs/canonical-product-architecture-baseline-v2`

## Goal

Replace the materially diverged PR #126 integration path with one reviewable canonical documentation branch created from current protected main, while preserving the durable product/architecture decisions and reconciling protected-main changes that landed after #126's original base.

## Completed in this successor

- [x] Start from exact protected main rather than the old docs ancestry.
- [x] Add code-current `docs/PRD.md`.
- [x] Add code-current `docs/TRD.md`.
- [x] Add logical service-owned `docs/DATA_MODEL.md` / ERD.
- [x] Add component/sequence/deployment/failure `docs/UML.md`.
- [x] Add `docs/API_CONTRACTS.md`.
- [x] Add `docs/THREAT_MODEL.md` while retaining `SECURITY.md` as reporting policy.
- [x] Add `docs/PRIVACY_DATA_LIFECYCLE.md`.
- [x] Add `docs/TEST_STRATEGY.md`.
- [x] Add `docs/OPERABILITY.md`.
- [x] Add `docs/RELEASE_AND_MIGRATION.md`.
- [x] Add `docs/STANDARDS_TRACEABILITY.md` with APA 7 references.
- [x] Add `docs/TRACEABILITY.md`.
- [x] Add `docs/DOCUMENTATION_ASSESSMENT.md`.
- [x] Normalize existing ADR 0001/0002 to the canonical status/quality contract.
- [x] Add ADRs for service data ownership, inert AI, purpose-bound privacy, work-conserving maintenance, canonical docs recovery, buyer-gap accounting and product hosting evolution.
- [x] Update root `ARCHITECTURE.md`, `README.md`, `AGENTS.md` and `CLAUDE.md` to expose the canonical graph.
- [x] Add deterministic documentation contract tests.
- [x] Reconcile #131 and protected-main #134-#138 evidence.
- [x] Mark PR #127 and PR #139 as active-PR evidence rather than shipped behavior.
- [x] Preserve issues #55/#121/#129/#130/#132 as explicit current product/governance gaps.

## Remaining before this successor is merge-ready

- [ ] Open the successor pull request against current `main`.
- [ ] Verify the exact successor head and live base after PR creation.
- [ ] Run/inspect formatting, package tests, documentation contract, CI, AppGuardrail, Semgrep, Security Scan, Commercial Readiness and current review evidence on one unchanged exact head.
- [ ] Fix every valid current-head finding and rerun the exact head.
- [ ] Confirm all canonical README links resolve and every ADR exact target/status passes the executable contract.
- [ ] Compare the successor's canonical family coverage with PR #126 and preserve any still-useful unique durable content that is not already represented here.
- [ ] Only after preservation/currentness is verified, close PR #126 as superseded and link the successor.
- [ ] Reconcile `CHANGELOG.md` if review identifies a buyer/operator-visible documentation change that belongs there.
- [ ] Merge only under the repository's actual exact-head protection/check policy.

## Post-merge continuation

Documentation completion is not the maintenance-loop exit condition. Immediately continue with the highest-value executable product work, currently including:

1. #121 / PR #127 durable Today integration;
2. #55 complete export/erasure orchestration after the protected-main recent-auth/ledger foundations;
3. #129 / PR #139 trusted calendar context followed by encrypted per-user credential lifecycle;
4. #130 plugin installation/secret/SSRF-safe delivery runtime;
5. #132 exact source-head versus merge-tree verification attribution;
6. next buyer-visible gap discovered from the protected integrated product journey.

## Verification discipline

No checkbox representing CI/review/merge is marked complete until fresh exact-head evidence proves it. Old PR #126 review resolutions are historical evidence only and are not carried forward as successor approval.