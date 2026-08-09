# Canonical Documentation Recovery Plan

**Date:** 2026-08-10  
**Current protected-main baseline:** `f4cae6d83eadb00019d2962a650c55c59a3349ae`  
**Successor branch:** `docs/canonical-product-architecture-baseline-v2`  
**Integration state:** canonical content is reconciled to `f4cae6d...`, but the branch ancestry must still absorb that protected-main commit before exact contributor-head CI can be authoritative.

## Goal

Replace the materially diverged PR #126 integration path with one reviewable canonical documentation branch, preserving durable product/architecture decisions while continuously reconciling protected-main changes that land before the successor merges.

## Completed in this successor

- [x] Start the successor from protected main rather than the old docs ancestry.
- [x] Add code-current PRD and TRD.
- [x] Add logical service-owned ERD/data model and code-current UML views.
- [x] Add API/event registry, Threat Model, Privacy/Data Lifecycle, Test Strategy, Operability, Release/Migration and Standards/Research documents.
- [x] Add requirement/source/test/issue/PR traceability and a documentation completeness assessment.
- [x] Normalize existing ADR 0001/0002 to the canonical status/quality contract.
- [x] Add ADRs for service data ownership, inert AI, purpose-bound privacy, work-conserving maintenance, canonical docs recovery, buyer-gap accounting and product hosting evolution.
- [x] Update root Architecture, README, AGENTS, CLAUDE and CHANGELOG to expose the canonical graph.
- [x] Add deterministic documentation contract tests.
- [x] Reconcile #131 and protected-main #134-#138 evidence.
- [x] Initially track #127/#139 as active PRs without promoting them to shipped behavior.
- [x] Reconcile PR #127 after its merge as protected main `f4cae6d83eadb00019d2962a650c55c59a3349ae` and issue #121 closure.
- [x] Reconcile commercial readiness from four unresolved canonical gaps to three unresolved gaps (#55/#129/#130) while preserving the durable registered #121 identity as resolved.
- [x] Keep PR #139 as active-PR evidence and #55/#129/#130/#132 as explicit live gaps.
- [x] Use a temporary read-only formatting-artifact workflow to obtain exact Prettier output for root docs, apply it, and remove the workflow before final validation.

## Remaining before this successor is merge-ready

- [x] Open successor PR #140 against `main`.
- [ ] Create a guarded non-force merge commit that makes current protected main `f4cae6d...` an ancestor while preserving the reconciled canonical tree.
- [ ] Verify the exact successor head and independently resolve the current live base after that merge.
- [ ] Run/inspect formatting, documentation contract, package tests, CI, AppGuardrail, Semgrep, Security Scan, Commercial Readiness and current review evidence on one unchanged exact head.
- [ ] Fix every valid current-head finding and rerun the exact head.
- [ ] Compare successor canonical-family coverage with PR #126 and preserve any still-useful unique durable content not represented here.
- [ ] Mark PR #140 ready only after current exact-head/base evidence is stable.
- [ ] Only after preservation/currentness is verified, close PR #126 as superseded and link #140.
- [ ] Merge only under actual repository policy with the unchanged verified head and current base relationship.

## Post-merge continuation

Documentation completion is not the maintenance-loop exit condition. Immediately continue with the highest-value executable product work, currently including:

1. #55 complete export/erasure orchestration beyond the protected-main recent-auth/ledger foundation;
2. #129 / PR #139 trusted calendar context followed by encrypted per-user credential lifecycle;
3. #130 plugin installation/secret/SSRF-safe delivery runtime;
4. #132 exact source-head versus merge-tree verification attribution;
5. the next buyer-visible gap discovered from the protected integrated journey.

The former #121 Today gap is complete on protected main and is no longer a post-merge backlog item.

## Verification discipline

No CI/review/merge checkbox is marked complete without fresh evidence on the exact current successor head. Old PR #126 review resolutions and earlier #140 heads are historical evidence only.