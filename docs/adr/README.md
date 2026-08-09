# LifeOS Architecture Decision Records

ADRs capture durable repository-wide decisions whose rationale should not be reconstructed from chat, old PR bodies or feature plans. Protected-main source/migrations/tests remain implementation evidence.

## Canonical status vocabulary

ADR status is exactly one of:

- `Implemented on protected main`
- `Implemented on active PR`
- `Partial`
- `Accepted architecture`
- `Planned`
- `Research only`
- `Superseded`
- `Out of scope`

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-opaque-non-numeric-identifiers.md) | Accepted architecture | Product-owned durable internal identifiers are opaque UUIDv4; provider IDs remain mappings. |
| [0002](0002-oauth-transactions-and-session-tokens.md) | Accepted architecture | OAuth transactions/session secrets are bounded/digest-based and real authentication age is separate from session rotation. |
| [0003](0003-domain-oriented-service-data-ownership.md) | Accepted architecture | Bounded services own persistence/migrations/credentials and never use hidden cross-service table authority. |
| [0004](0004-inert-auditable-ai-proposals.md) | Accepted architecture | AI output is an inert auditable proposal; deterministic/user authority remains separate. |
| [0005](0005-purpose-bound-sensitive-data-access.md) | Accepted architecture | Sensitive access is actor/workspace/resource/purpose/lifetime bound and auditable. |
| [0006](0006-work-conserving-autonomous-maintenance.md) | Accepted architecture | Autonomous maintenance is live-evidence, work-conserving, exact-head and writer-lease aware. |
| [0007](0007-canonical-documentation-graph.md) | Accepted architecture | One canonical code-current documentation graph may use a clean current-main successor when the prior docs branch materially diverges. |
| [0008](0008-capability-maturity-and-buyer-gaps.md) | Accepted architecture | Configured capability maturity and canonical buyer-gap exhaustion are independent evidence dimensions. |
| [0009](0009-product-hosting-and-data-evolution.md) | Accepted architecture | Multi-user server-backed modular MSA supersedes local-first-only/private/single-app primary architectures while preserving explicit local drafts and Compose profiles. |

## ADR quality contract

A new material ADR includes:

1. `## Context`
2. `## Decision drivers`
3. `## Considered alternatives`
4. `## Decision`
5. `## Consequences`
6. `## Failure and recovery`
7. `## Security and privacy impact`
8. `## Acceptance evidence`
9. `## Migration and rollback`
10. `## Supersession`

A feature plan is not a substitute for an ADR when a decision changes repository-wide product authority, identity, persistence ownership, security/privacy boundary, deployment model, interoperability or release criteria.

## Update rule

When protected-main evidence no longer matches an ADR, do not silently edit history to hide the change. Add a new ADR or an explicit supersession record, update the index/status and reconcile PRD/TRD/Architecture/Data Model/UML/Threat Model/Traceability as applicable.