# ADR 0009: Product hosting and data-authority evolution

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context
Early LifeOS exploration proposed a private/login-free local-first PWA and later a simple single-Docker application. The product then moved to a public multi-user cloud/self-hostable service with Google/GitHub login, PostgreSQL durability and domain-oriented services. Retaining all historical options as current created contradictory architecture claims.

## Decision drivers
Cross-device durability, explicit account/workspace authority, public/self-hosted deployment, independent service ownership, privacy/auditability and modular CWL composition.

## Alternatives considered
1. Browser-only IndexedDB as system of record — superseded as primary architecture.
2. Single durable application owning all domains — superseded as durable architecture.
3. Provider-hosted proprietary backend — rejected as product dependency.
4. Multi-user server-backed self-hostable modular MSA with explicit local-draft boundary — selected.

## Decision
LifeOS is a multi-user server-backed and self-hostable modular MSA. Google/GitHub identity establishes server-authorized accounts/workspaces. Domain services own durable state in PostgreSQL and may use NATS/versioned HTTP/event contracts. Browser-local state is explicit draft/cache/offline UX until accepted by the owning service. Compose remains a valid self-hosted composition profile but does not collapse service authority.

## Consequences
Operators provision durable infrastructure/secrets/provider registration, while users gain cross-device durability and auditable authority. Offline UX requires explicit reconciliation rather than pretending local state is globally durable.

## Failure and recovery
Loss of browser-local draft does not imply loss of durable service state. Service/provider outages degrade bounded workflows without changing ownership. Backup/restore protects durable PostgreSQL within documented scope.

## Security and privacy impact
Multi-user operation requires tenant isolation, server-derived authority, purpose-bound sensitive access and credential separation. Local drafts remain locally scoped until explicit upload/sync.

## Acceptance evidence
Protected-main service layout, identity/workspace persistence, durable planning/Today, PostgreSQL/NATS composition, Kubernetes reference and `ARCHITECTURE.md`.

## Migration and rollback
Historical local-first data is migrated only through explicit user-controlled/import/sync flows. Do not silently upload local drafts. Deployment rollback cannot collapse service-owned data authority into a shared monolith.

## Supersession
Only a reviewed product-hosting/data-authority ADR with migration, privacy, offline, deployment and compatibility evidence may supersede this architecture.