# LifeOS product and technical gap baseline

This document tracks buyer-visible and release-blocking gaps against the current repository architecture. It is evidence, not a roadmap promise: a gap is closed only by protected, executable acceptance evidence or by a released external owner contract that LifeOS actually consumes.

## Authority and status rules

`AGENTS.md` and `ARCHITECTURE.md` remain the repository-wide operating and architectural authorities. Feature designs, plans, ADRs, operations documents, issues, pull requests, tests, and release evidence provide scoped detail. This baseline must not invent domain truth, provider behavior, performance, compliance status, or release readiness.

Status meanings:

- **proven** — executable evidence exists on the named exact source and the behavior is retained by the current descendant;
- **draft** — implementation exists only on an unmerged branch or still lacks required review/gates;
- **blocked by owner** — LifeOS cannot complete the gap without a released/versioned contract from the canonical owning repository;
- **open** — LifeOS owns an actionable implementation or evidence gap.

## Current gaps

| Area | Current evidence | Status | Closure condition |
| --- | --- | --- | --- |
| Planning completion chronology | Draft stack #266 → #267 → #268 → #269 establishes current-state chronology, authenticated completion mutation and durable historical completion facts. #269 has real PostgreSQL evidence for append-only completion history and preserves explicit `DELETE` for erasure/cascade while rejecting table-wide `TRUNCATE`. | draft | Ancestors integrate normally, descendants are non-force restacked, applicable exact-head repository/security gates and an actual independent approval pass, then protected ancestry contains the retained contracts. |
| Weekly Review authoritative task metrics | #263 requires producer-owned projections. Planning currently has completion history but no approved due-date, status-transition or activity chronology sufficient to define `overdue`, `stalled` or `inactive`. | open | Define explicit estimands and producer-owned source fields first; then expose authenticated versioned projections with provenance, `unavailable ≠ 0`, real PostgreSQL/E2E and measured buyer-path performance. |
| Model-provider ownership | Protected LifeOS still contains direct `NVIDIA_NIM_API_KEY` assumptions in canonical AI docs and live-conformance code. Contextual-orchestrator issue #1023 owns the missing released Actions/API/auth/provenance boundary; the owner currently has no GitHub release. LifeOS consumer work is tracked by #227 and #271. | blocked by owner | Contextual-orchestrator RED → GREEN → immutable release, followed by exact released LifeOS bump using only the gateway credential and `orchestrator/free`; remove provider/model/group/fallback ownership from LifeOS and update canonical docs. |
| GitHub Action runtime deprecation | Hosted Actions reports that pinned `actions/checkout` and `actions/setup-node` revisions target deprecated Node 20. Persistent repository occurrences are tracked by #270. | open | Pin reviewed current Node-24-backed action releases by immutable SHA, preserve permissions/exact-head checkout/security gates, and prove the warning is absent on exact-head CI/deploy evidence. |
| Dependency build-script policy | Frozen pnpm install reports `Ignored build scripts: esbuild`; #272 owns the supply-chain decision rather than suppressing the warning. | open | Establish whether the script is required, then remove the dependency path or add the narrowest audited pnpm build-script allowlist with exact-head install/build/test/security evidence and no warning. |
| Released outbound/egress foundation | LifeOS may consume EgressWeave only through an immutable released/versioned owner contract; mutable sibling source is not an integration boundary. | blocked by owner | Consume an immutable EgressWeave release only after owner release evidence exists and the LifeOS consumer contract passes exact-head tests/security. |
| Release readiness | Draft Planning stack and the owner gaps above prevent a truthful product release claim. | open | Protected exact head must pass version/CHANGELOG/package/SBOM/provenance/reproducibility/rollback and all required repository/security/review gates before tag and immutable release publication. |

## Planning acceptance detail

The current Planning work deliberately separates three truths:

1. the current task row owns current `status` and `completed_at`;
2. `task_completion_facts` owns append-only historical completion evidence that can survive reopen;
3. Weekly Review metrics must be derived from explicit producer-owned chronology and estimands, not browser-entered counts or cross-service SQL.

A current `todo` task may therefore coexist with historical completion facts. Data-rights export exposes user-owned task/timestamp evidence while internal fact identity/order remain Planning persistence detail. Explicit erasure and task-owned cascade use `DELETE`; accepted history rejects ordinary mutation and table-wide `TRUNCATE`.

## Next executable buyer gap

After the current Planning stack reaches protected ancestry, the next Planning-owned slice is due/status-transition/activity chronology sufficient to define one estimand at a time. Do not implement `overdue`, `stalled` or `inactive` labels before the source fields, observation window, threshold, denominator and unavailable-data behavior are written as executable contracts.

External-owner work proceeds independently: contextual-orchestrator must publish its immutable gateway contract before LifeOS removes the direct provider bridge, and EgressWeave must publish an immutable release before LifeOS can claim a released outbound authority.

<!-- lifeos-writer:chatgpt-hourly-maintainer -->
