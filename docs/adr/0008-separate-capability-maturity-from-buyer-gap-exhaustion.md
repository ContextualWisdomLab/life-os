# ADR 0008: Separate capability maturity from buyer-gap exhaustion

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context
The configured readiness capability manifest could reach 100% while accepted customer journeys still had explicit open gaps. Treating capability-evidence maturity as whole-product completeness creates misleading commercial readiness claims.

## Decision drivers
Truthful product readiness, deterministic repository-owned gap identity, fail-closed unknown issue state, auditability and non-executable untrusted issue prose.

## Alternatives considered
- use one aggregate capability score as completion — rejected;
- parse arbitrary issue text as product policy — rejected;
- maintain a versioned repository-owned buyer-gap registry and reconcile bounded issue state separately — selected.

## Decision
Capability evidence maturity and canonical buyer-gap state are separate dimensions. The buyer-gap registry owns durable gap identity and links to issue/capability IDs. Issue title/body/comment/model/review prose is untrusted and never becomes executable policy. Gap state is `open`, `resolved` or `unknown`; missing/ambiguous evidence fails closed to unknown.

## Consequences
A repository may correctly report 22/22 configured capabilities while still listing open buyer gaps. Product/release decisions must inspect both dimensions plus end-to-end/operational evidence.

## Failure and recovery
GitHub evidence collection failure cannot turn a gap into resolved. Registry validation rejects duplicates, malformed IDs and unknown capability links. Recovery reruns bounded state collection without rewriting policy from remote prose.

## Security and privacy impact
Only bounded issue identifiers/state are needed for readiness; untrusted bodies and unnecessary content are excluded from retained policy evidence.

## Acceptance evidence
Protected-main buyer-gap registry/validation/rendering and issue #21 currently report configured maturity separately from #55/#129/#130 buyer gaps.

## Migration and rollback
Existing capability maturity fields remain compatible. Buyer-gap fields are additive; rollback must not reinterpret absent buyer-gap evidence as zero gaps.

## Supersession
A successor readiness model must preserve explicit distinction between configured evidence maturity and whole-product/customer outcome completeness.