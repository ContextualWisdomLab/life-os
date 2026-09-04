# ADR 0010: Separate verification evidence identities

**Status:** Accepted architecture

## Context

GitHub pull-request workflows can evaluate more than one commit identity. A contributor branch head, the base snapshot recorded when the pull request was created or updated, the current live base-branch tip, GitHub's synthetic merge tree, the commit actually checked out by a workflow job, protected main, and a released artifact answer different questions. Treating one of those identities as a substitute for another can create stale or false verification claims.

Issue #132 identified this as a repository-governance reliability gap. PR #147 implements the bounded workflow correction as active-PR evidence; it is not protected-main behavior until merged.

## Decision drivers

- exact attribution of source-verification evidence;
- explicit integration-compatibility evidence;
- resistance to stale base assumptions;
- auditable merge and release decisions;
- no promotion of queued, predecessor or synthetic-only evidence into exact-head success.

## Considered alternatives

1. **Use the pull-request event/base metadata as the current base everywhere.** Rejected because a PR base snapshot can become stale as the protected base branch moves.
2. **Treat the synthetic merge tree as the contributor source head.** Rejected because it proves a different tree and can hide which source revision was directly evaluated.
3. **Run only source-head checks and ignore integration compatibility.** Rejected because a clean source branch can still fail when integrated with the current base.
4. **Track evidence identities separately and require the appropriate identity for each gate.** Selected.

## Decision

LifeOS verification and release evidence distinguishes at least:

- `source_head_sha`: exact contributor/source branch head whose source correctness is being evaluated;
- `pr_base_snapshot_sha`: GitHub's immutable base snapshot associated with the pull-request representation/event;
- `live_base_tip_sha`: independently resolved current tip of the actual base branch immediately before a base-sensitive decision;
- `merge_tree_sha`: synthetic integration tree used for merge-compatibility evidence;
- `workflow_checkout_sha`: commit/tree a specific workflow job actually checked out;
- `protected_main_sha`: exact integrated protected-main revision;
- `release_source_sha`: protected source identity bound to a published release artifact.

A check is evidence only for the tree it actually inspects. Source correctness checks bind to `source_head_sha`. Merge/integration compatibility may bind to `merge_tree_sha`, but that evidence is labeled separately. Base-sensitive merge decisions independently resolve `live_base_tip_sha`; `pr_base_snapshot_sha` cannot silently substitute for it.

Required merge/release decisions may consume multiple evidence classes, but they do not collapse them into one generic green status.

## Consequences

- Workflow configuration and evidence payloads become more explicit.
- Existing required context names may remain stable while their checked-out revision contract is corrected.
- Operators can determine whether a failure belongs to source correctness, integration compatibility, current-base drift, infrastructure or release packaging.
- A synthetic merge success cannot prove that the exact contributor source head itself was directly checked where exact-head evidence is required.

## Failure and recovery

If the source head, live base, or relevant checked-out tree changes after evaluation, the affected evidence is stale and must be reacquired. If an evidence-producing workflow cannot determine which commit it inspected, it fails closed or is classified unavailable rather than being promoted to passing evidence. A failed integration tree blocks integration only; it does not create an invented source-code finding without source-backed evidence.

## Security and privacy impact

Explicit evidence identity reduces stale-check and confused-deputy risk in repository governance. Evidence remains credential-free and records opaque commit identities/status classifications rather than secrets or tenant content. It does not grant additional repository, review, merge or release authority.

## Acceptance evidence

Acceptance requires deterministic tests that distinguish source-head and synthetic-merge checkout semantics and hosted workflow evidence showing each lane evaluates the intended tree. PR #147 is `Implemented on active PR` for the initial CI/AppGuardrail/source-versus-merge correction while issue #132 remains open until protected-main integration and any remaining required-workflow attribution is reconciled.

## Migration and rollback

Adopt the distinction incrementally without renaming existing required check contexts unless repository policy requires it. A rollback must not restore ambiguous claims: if a source/merge separation is removed, affected evidence is explicitly classified unavailable or the older behavior is accompanied by an equivalent proof of exact source identity. No historical check is reinterpreted as evidence for a different commit tree.

## Supersession

This ADR remains authoritative until a later accepted decision provides an equal or stronger evidence-identity model and updates workflow contracts, documentation, merge governance and release acceptance together.
