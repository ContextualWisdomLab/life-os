# LifeOS Architecture Decision Records

ADRs capture durable decisions whose rationale would otherwise be reconstructed from old chat, PR bodies, feature plans, or code archaeology. Protected-main code and tests remain the implementation evidence.

## Status meanings

- **Accepted** — current architecture/governance decision.
- **Proposed** — reviewed direction awaiting acceptance/implementation evidence.
- **Superseded** — replaced by a later ADR; retained for rationale.
- **Deprecated** — still observable but should not be used for new work.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-product-hosting-and-data-evolution.md) | Accepted | Multi-user server-backed, self-hostable LifeOS supersedes local-first-only and single-app primary architectures |
| [0002](0002-internal-identifiers-uuidv4.md) | Accepted | Internal identifiers are opaque UUIDv4; old UUIDv7 design language is superseded |
| [0003](0003-domain-oriented-service-data-ownership.md) | Accepted | Domain services own persistence and communicate through versioned contracts, never cross-service table access |
| [0004](0004-inert-auditable-ai-proposals.md) | Accepted | AI output is an inert auditable proposal; deterministic/user authority remains separate |
| [0005](0005-purpose-bound-sensitive-data-access.md) | Accepted | Sensitive data uses purpose-bound authorization and auditable grants rather than blanket masking |
| [0006](0006-work-conserving-autonomous-maintenance.md) | Accepted | Autonomous maintenance is exact-head, work-conserving, and blocker-local |
| [0007](0007-canonical-documentation-graph.md) | Accepted | Canonical docs require explicit as-built/planned/superseded status and code/test traceability |

## ADR quality contract

New material ADRs include:

1. context and problem;
2. decision drivers;
3. considered alternatives;
4. decision and scope;
5. consequences/trade-offs;
6. failure and recovery behavior;
7. security/privacy/governance impact;
8. acceptance/test evidence;
9. migration/rollback path;
10. supersession conditions.

A feature plan is not a substitute for an ADR when the decision affects repository-wide authority, ownership, identity, persistence, security, deployment, interoperability, or release criteria.
