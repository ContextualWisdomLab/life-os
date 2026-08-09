# ADR-0008: Separate capability maturity from buyer-gap exhaustion

**Status:** Accepted architecture

## Context

LifeOS commercial-readiness evidence historically summarized configured capability maturity and rendered unresolved gaps from the same configured capability set. That is useful for determining whether a registered capability has its required files, tests, controls, and evidence, but it is not equivalent to proving that the whole product has no remaining buyer-visible gaps.

Protected-main evidence can therefore report every configured capability at target while accepted customer journeys remain incomplete. At the current baseline, end-to-end tenant export/deletion (#55), durable multi-device Today synchronization (#121), hosted per-user calendar credentials (#129), and generic plugin runtime delivery (#130) remain distinct product gaps even when their related core capability evidence is mature.

Issue #128 records this defect. Active PR #131 implements a versioned repository-owned buyer-gap registry and explicit issue-state reconciliation. Until that PR is integrated, it is active-PR evidence rather than protected-main evidence.

## Decision drivers

- Commercial-readiness reporting must not convert configured evidence completeness into a claim of whole-product completeness.
- Buyer-gap identity must be deterministic and reviewable.
- Arbitrary issue, review, model, or comment prose is untrusted data and cannot become executable product policy.
- Missing or ambiguous live issue evidence must fail closed rather than silently resolve a gap.
- Release and autonomous-development decisions need separate views of capability maturity and remaining customer/operator outcomes.

## Alternatives considered

### Keep one scalar capability score

Rejected. A single configured score is compact but loses the distinction between mature foundations and incomplete end-to-end journeys.

### Treat every open GitHub issue as a buyer gap

Rejected. Issue text and labels are mutable, heterogeneous, and may represent bugs, chores, research, duplicates, or untrusted content. This would make arbitrary repository prose executable governance input.

### Maintain buyer gaps manually only in prose

Rejected. A prose-only ledger is hard to validate, can drift from live issue state, and is unsuitable for deterministic automation.

### Repository-owned gap registry plus bounded live state reconciliation

Selected. The repository owns stable gap identifiers and their intended issue/capability linkage; automation consumes only bounded issue state needed to decide `open`, `resolved`, or `unknown`.

## Decision

LifeOS maintains **two independent readiness dimensions**:

1. **Configured capability-evidence maturity** — whether each registered capability has reached its evidence target under the existing capability contract.
2. **Canonical buyer-gap state** — whether repository-owned durable product/operator gaps are open, resolved, or unknown according to a versioned gap registry and bounded live evidence.

The two dimensions may be correlated but are never interchangeable. A 100% capability maturity result must not imply zero buyer gaps.

Canonical buyer-gap identity is defined in repository-owned versioned data, not by arbitrary issue title/body/comment/review/model text. Live GitHub issue state may reconcile that identity but cannot redefine it.

If a registered gap cannot be fetched or its state is ambiguous, the report records `unknown`; it does not silently treat the gap as resolved. Closing a gap in product governance requires the expected issue state plus code/test/operational evidence appropriate to the linked PRD requirement.

Release readiness consumes both dimensions together with exact protected-head CI, security, review, migration, backup/recovery, accessibility, packaging/provenance, and operator evidence.

## Consequences

### Positive

- Commercial-readiness reports become more truthful about the difference between strong foundations and complete buyer journeys.
- Autonomous development can prioritize explicit product gaps without scraping arbitrary issue prose into policy.
- Unknown evidence remains visible instead of being converted into optimistic success.
- Capability evidence can remain stable and useful without being overloaded into a whole-product completeness metric.

### Trade-offs

- Readiness output contains more than one headline dimension and therefore requires clearer operator/product interpretation.
- The buyer-gap registry becomes another versioned governance artifact that must be reviewed when gaps are created, superseded, split, or resolved.
- Gap closure requires evidence reconciliation rather than simply closing an issue or raising a capability score.

## Failure and recovery

If the buyer-gap registry is malformed, duplicated, refers to unknown capabilities, exceeds bounded limits, or cannot be reconciled safely, readiness evaluation fails closed for the buyer-gap dimension.

If the GitHub issue-state dependency is temporarily unavailable, affected gap states become `unknown`; deterministic capability evidence continues to be computed independently. A later run may reconcile the same stable gap identity after live evidence returns.

If a gap is split or superseded, update the registry and traceability in a reviewed change. Do not rewrite historical readiness artifacts in place.

## Security, privacy, and governance impact

- Issue bodies, comments, review text, and model output remain untrusted and non-executable.
- The live collector requests only bounded state required for registered gaps and does not retain arbitrary issue bodies as policy.
- Repository-owned gap IDs and capability links are reviewable source artifacts.
- Unknown/fetch-failure behavior is fail-closed and cannot manufacture a zero-gap result.
- This ADR changes readiness interpretation, not branch protection, merge authority, reviewer identity, or product-data authorization.

## Acceptance and test evidence

The implementing contract must prove at least:

- a repository-owned versioned gap registry;
- rejection of malformed IDs, duplicate gap ownership, unknown capability references, duplicate capability links, and excessive collections;
- deterministic `open`, `resolved`, and `unknown` reconciliation;
- fetch failure and ambiguous evidence becoming `unknown` rather than `resolved`;
- no raw issue body/comment/review text retained as executable policy;
- capability maturity remaining backward-compatible as its own dimension;
- separate rendered/report fields for capability-evidence gaps and buyer-gap/unknown state;
- canonical PRD/traceability documents identifying active-PR versus protected-main implementation accurately.

At the time of this ADR, PR #131 is the active implementation path. No protected-main implementation claim transfers until its exact reviewed head is merged.

## Migration and rollback

The change is additive to the existing capability evidence model. Existing capability identifiers and maturity targets remain unchanged.

If rollout must be reverted, remove the new buyer-gap reporting path while preserving the existing capability calculation and the repository gap registry/history for later repair. Do not reinterpret historical 100% capability reports as historical proof of zero buyer gaps.

## Supersession

Supersede this ADR only with a reviewed decision that provides an equally deterministic separation between configured capability evidence and whole-product/customer-outcome completeness, preserves untrusted-text boundaries, defines fail-closed unknown semantics, and includes migration of existing gap identity/history.
