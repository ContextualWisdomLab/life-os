# ADR 0008: Separate capability maturity from buyer-gap exhaustion

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context

LifeOS previously could report every configured capability at its target while accepted buyer-visible gaps still existed. A capability evidence score measures the registered evidence slice; it does not prove every end-to-end customer outcome is complete.

## Decision drivers

- prevent false whole-product completion claims;
- make buyer-visible gaps deterministic and auditable;
- keep arbitrary issue prose from becoming executable policy;
- preserve usefulness of capability maturity as a separate metric.

## Considered alternatives

1. Treat 100% configured maturity as product completion — rejected.
2. Infer gaps by free-form issue title/body scanning — rejected because untrusted prose is not stable executable policy.
3. Maintain a repository-owned canonical gap registry and reconcile live issue state separately from capability evidence — selected.

## Decision

Commercial readiness reports at least two independent dimensions:

- configured capability-evidence maturity;
- canonical buyer-gap state (`open`, `resolved`, `unknown`).

The repository owns durable gap IDs and their linked issue/capability identities. Missing/ambiguous issue evidence fails closed to `unknown`, not resolved. Raw issue/comment/review/model prose does not become product policy.

## Consequences

- 100% capability maturity can coexist honestly with unresolved buyer gaps;
- issue lifecycle changes must reconcile the repository-owned gap registry;
- product development continues after the capability table reaches target.

## Failure and recovery

If live issue state cannot be fetched or mapped unambiguously, report unknown buyer-gap state and preserve the previous durable gap identity. Do not fabricate zero gaps.

## Security and privacy impact

Only bounded issue identity/state is needed for canonical reconciliation; untrusted issue bodies do not become executable configuration.

## Acceptance evidence

Protected main includes the buyer-gap registry/reconciliation and current commercial-readiness issue #21 reports 22/22 configured maturity separately from four unresolved canonical buyer gaps.

## Migration and rollback

Legacy reports/consumers that used a single `unresolved_gaps` concept retain compatibility only as explicitly documented capability evidence. Whole-product readiness consumers migrate to the separate buyer-gap dimensions.

## Supersession

This ADR supersedes any interpretation that configured capability maturity alone proves whole-product gap exhaustion.