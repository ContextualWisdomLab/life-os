# LifeOS Architecture Decision Records

ADRs capture durable decisions that must not be reconstructed from chat history or old PR bodies. Protected-main source/tests remain implementation evidence.

## Status vocabulary

ADR status uses the same exact canonical documentation values: `Implemented on protected main`, `Implemented on active PR`, `Partial`, `Accepted architecture`, `Planned`, `Research only`, `Superseded`, `Out of scope`.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-opaque-non-numeric-identifiers.md) | Accepted architecture | Internal identifiers are opaque UUIDv4; old UUIDv7 design language is superseded |
| [0002](0002-oauth-transactions-and-session-tokens.md) | Accepted architecture | Server-owned OAuth transaction/session security and authentication provenance |
| [0003](0003-service-owned-persistence.md) | Accepted architecture | Bounded services own persistence/migrations/credentials and never cross-write tables |
| [0004](0004-inert-auditable-ai-proposals.md) | Accepted architecture | AI output is inert auditable proposal evidence with explicit decisions |
| [0005](0005-purpose-bound-sensitive-data-access.md) | Accepted architecture | Sensitive access is tenant/resource/purpose/lifetime/audit bound |
| [0006](0006-work-conserving-autonomous-maintenance.md) | Accepted architecture | Autonomous maintenance is exact-state, single-writer and work-conserving |
| [0007](0007-canonical-documentation-graph.md) | Accepted architecture | One code-current canonical documentation graph with explicit maturity |
| [0008](0008-separate-capability-maturity-from-buyer-gap-exhaustion.md) | Accepted architecture | Capability maturity is separate from buyer-gap exhaustion |
| [0009](0009-product-hosting-and-data-evolution.md) | Accepted architecture | Server-backed self-hostable modular MSA supersedes browser-only/single-app primary architecture |
| [0010](0010-verification-evidence-identity.md) | Accepted architecture | Contributor source, PR-base snapshot, live base, synthetic merge, workflow checkout, protected-main and release identities remain separate evidence authorities |
| [0011](0011-external-integration-authority-and-secret-references.md) | Accepted architecture | External integration metadata uses LifeOS-owned identity, separate secret references and explicit host-granted capability authority |
| [0012](0012-test-time-compute-and-model-development-authority.md) | Accepted architecture | Strong single-route baseline, measured orchestration selection, NVIDIA/OpenCode credential boundary and model-vs-review/merge/release authority separation |

## ADR quality contract

Material ADRs contain: context; decision drivers; alternatives; decision; consequences; failure/recovery; security/privacy/governance impact; acceptance evidence; migration/rollback; and supersession conditions.

A feature plan is not a substitute for an ADR when authority, identity, persistence, security, deployment, interoperability or release criteria change.
