# Claude operating contract for LifeOS

`AGENTS.md` is the canonical repository-wide agent instruction file. `docs/PRD.md`, `docs/TRD.md`, `ARCHITECTURE.md`, `docs/adr/README.md`, `docs/DATA_MODEL.md`, `docs/UML.md`, `docs/THREAT_MODEL.md`, `docs/TEST_STRATEGY.md`, `docs/OPERABILITY.md`, and `docs/TRACEABILITY.md` are the canonical product/technical evidence graph. This document maps them into a concise execution order and must not override live branch protection, security policy, or protected-main behavior.

## Execution order

1. Refetch every open PR, exact current head and exact live base tip before relying on historical state.
2. Read all human, CodeRabbit, AppGuardrail, code-scanning, security and configured automated feedback.
3. Determine the first causal boundary of every failed/missing/stale/required check and verify a remedy is operationally real.
4. Make the smallest complete test-first correction, including documentation/cleanup/migration evidence required by the root cause.
5. Rerun/inspect exact-head verification and resolve only threads whose underlying finding is actually fixed.
6. Merge only when repository protections accept the unchanged exact head and no actionable finding remains.
7. Immediately continue with another safe PR/review/cleanup/documentation/product/operability/release-readiness task while finite run budget remains.
8. When PR work is exhausted, implement the highest-impact bounded buyer-visible product gap rather than ending at gap identification.

A successful commit, PR creation, merge, documentation pack, review request, check dispatch, queued workflow, or RCA is an intermediate result while safe work remains. Routine status narration is not repository evidence.

## Writer/concurrency discipline

Before branch-affecting writes, refetch exact target head/base/ref/blob. If another source writer moves the same target, discard stale assumptions, freeze only that target for the run, and continue non-conflicting work. Never turn one branch conflict or unavailable tool path into a repository-wide stop.

## Architecture boundaries

- LifeOS is multi-user, server-backed, self-hostable and domain-oriented; early browser-only local-first/single-app primary designs are historical/superseded.
- Internal identifiers are opaque UUIDv4 strings; old UUIDv7 design language is superseded.
- Database objects use descriptive multiword `snake_case` unless an external protocol requires otherwise.
- Services do not read or mutate another service's database tables.
- Browser-local drafts/caches do not become durable truth until an authorized owning service confirms persistence.
- AI proposals remain inert until a separately authorized domain execution capability exists.
- Sensitive access uses purpose/resource/actor/lifetime controls and auditable evidence; blanket masking is not an authorization model.

## Documentation discipline

Use exact statuses: `Implemented on protected main`, `Implemented on active PR`, `Partial`, `Accepted architecture`, `Planned`, `Research only`, `Superseded`, `Out of scope`.

Do not present active-PR/roadmap behavior as shipped. When source/tests disagree with prose, correct the prose or behavior according to the approved product decision; do not use documentation to override protected-main runtime truth.

The original `docs/superpowers/specs/2026-08-02-life-os-design.md` is historical input. Canonical docs/ADRs explicitly reconcile its local-first/single-app/UUIDv7/post-MVP assumptions with current architecture.

When documentation exposes a missing product journey, stale runtime contract, migration/recovery gap, security/privacy flaw, accessibility issue or release blocker, continue into executable work when safe rather than stopping at the audit.

## LLM orchestration decisions

Use a strong single-model route as the mandatory baseline. Allocate additional test-time compute only through explicit profiles identifying reasoning effort, workflow stages, roles, decomposition, recursive depth and access topology, justified by measured validity/grounding/utility/safety evidence rather than latency alone.

Model-assisted tests/development use `NVIDIA_NIM_API_KEY` through the approved OpenCode/contextual-orchestrator boundary where required. Do not casually alter independent review-agent credential schemes. Deterministic checks remain meaningful when the live provider is absent or unavailable; provider failures produce sanitized unavailable evidence, never fabricated scores.

## Verification standard

- Production declarations have explanatory docstrings.
- Packages with exact gates maintain 100% statement, branch, function and line coverage using meaningful tests.
- Persistence behavior uses realistic PostgreSQL tests for tenant, transaction, replay, concurrency and recovery semantics.
- Core web journeys include accessibility/localization/mobile/PWA evidence where relevant.
- Standards/research claims use appropriate primary/current sources with APA 7 traceability and publication-status distinctions.
- `CHANGELOG.md` records buyer-visible behavior.
- Canonical PRD/TRD/architecture/ADR/data/UML/threat/test/operability/traceability documents remain code-current.
- Release versions/tags are created only after exact integrated release readiness; unreleased work stays under `Unreleased`.

## Safe escalation

Escalate only for a concrete external decision, permission, secret, governance action or safety boundary that cannot be derived/resolved from current repository evidence and realistically available tools after alternatives are tested. Waiting for checks/reviews/providers is not itself an escalation condition; continue independent work.
