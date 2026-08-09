# LifeOS Architecture Decision Records

ADRs capture durable decisions whose rationale would otherwise be reconstructed from old chat, PR bodies, feature plans, or code archaeology. Protected-main code and tests remain the implementation evidence.

## Status meanings

ADR status uses the same exact vocabulary as the canonical product documentation:

- **Implemented on protected main** — the decision and its required implementation evidence are present on protected main.
- **Implemented on active PR** — implementation exists on a current PR but is not protected-main evidence.
- **Partial** — important parts exist, but the complete decision contract is not implemented.
- **Accepted architecture** — current reviewed architecture/governance decision; implementation may be partial or pending.
- **Planned** — accepted work direction without an implementation claim.
- **Research only** — exploratory evidence outside the production contract.
- **Superseded** — replaced by a later decision and retained for rationale.
- **Out of scope** — intentionally excluded from the current product contract.

Qualifiers, implementation evidence, PR numbers, and scope notes belong in ADR prose rather than being appended to the status value.

## ADR identity

The repository contained historical ADR numbers before this canonical index was introduced. In particular, two durable records already carry the `0002` prefix: the protected-main OAuth/session decision and the later canonical UUIDv4 decision. Renumbering an accepted historical decision would break provenance, so the **full filename is the stable ADR identity**. The numeric prefix remains an ordering aid only and is not assumed globally unique across pre-baseline history.

New ADRs must use an unused numeric prefix. Existing collisions are indexed with unambiguous filename-derived labels and must not be silently dropped or rewritten.

## Index

| ADR identity | Status | Decision |
| --- | --- | --- |
| [0001-opaque-non-numeric-identifiers](0001-opaque-non-numeric-identifiers.md) | Superseded | Historical UUIDv4/non-numeric identifier decision, retained and superseded by the canonical UUIDv4 formulation |
| [0002-oauth-transactions-and-session-tokens](0002-oauth-transactions-and-session-tokens.md) | Implemented on protected main | OAuth anti-replay, PKCE/OIDC transaction binding, provider separation, and revocable workspace-scoped session-token handling |
| [0002-internal-identifiers-uuidv4](0002-internal-identifiers-uuidv4.md) | Accepted architecture | Internal identifiers are opaque UUIDv4; old UUIDv7 design language is superseded |
| [0003-domain-oriented-service-data-ownership](0003-domain-oriented-service-data-ownership.md) | Accepted architecture | Domain services own persistence and communicate through versioned contracts, never cross-service table access |
| [0004-inert-auditable-ai-proposals](0004-inert-auditable-ai-proposals.md) | Accepted architecture | AI output is an inert auditable proposal; deterministic/user authority remains separate |
| [0005-purpose-bound-sensitive-data-access](0005-purpose-bound-sensitive-data-access.md) | Accepted architecture | Sensitive data uses purpose-bound authorization and auditable grants rather than blanket masking |
| [0006-work-conserving-autonomous-maintenance](0006-work-conserving-autonomous-maintenance.md) | Accepted architecture | Autonomous maintenance is exact-head, work-conserving, and blocker-local |
| [0007-canonical-documentation-graph](0007-canonical-documentation-graph.md) | Accepted architecture | Canonical docs require explicit as-built/planned/superseded status and code/test traceability |
| [0008-separate-capability-maturity-from-buyer-gap-exhaustion](0008-separate-capability-maturity-from-buyer-gap-exhaustion.md) | Implemented on protected main | Configured capability maturity and canonical buyer-gap exhaustion are independent readiness dimensions |
| [0009-product-hosting-and-data-evolution](0009-product-hosting-and-data-evolution.md) | Accepted architecture | Multi-user server-backed, self-hostable LifeOS supersedes local-first-only and single-app primary architectures |

## ADR quality contract

Every material ADR, including historical records retained in the canonical index, includes:

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

A feature plan is not a substitute for an ADR when the decision affects repository-wide authority, ownership, identity, persistence, security, deployment, interoperability, governance interpretation, or release criteria.
