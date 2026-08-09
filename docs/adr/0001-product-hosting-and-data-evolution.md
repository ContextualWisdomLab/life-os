# ADR-0001: Product hosting and data architecture evolution

**Status:** Accepted  
**Date:** 2026-08-09

## Context

LifeOS exploration initially considered a private/login-free local-first PWA whose primary store was browser IndexedDB. A later option considered a single Docker application. The product subsequently became a public multi-user system with Google/GitHub authentication, account/workspace isolation, PostgreSQL durability, cross-device use, and independently bounded services.

Keeping all three models as apparently current creates contradictory privacy, synchronization, deployment and ownership assumptions.

## Drivers

- durable cross-device user state;
- explicit tenant/workspace isolation;
- self-hostability without provider lock-in;
- independent service ownership and testability;
- auditable AI/integration/privacy boundaries;
- local/PWA usability without making browser storage the hidden source of truth.

## Alternatives

1. **Browser local-first only.** Lowest server/privacy burden, but no authoritative multi-device synchronization or server-side integration lifecycle.
2. **One monolithic Docker application.** Simple deployment, but weakens independent bounded-context ownership and makes future service isolation harder.
3. **Domain-oriented modular MSA with Compose/Kubernetes composition.** More explicit operations, but preserves portable deployment and independent authority.

## Decision

LifeOS is a **multi-user, server-backed, self-hostable modular MSA product**. PostgreSQL-backed bounded services own durable user/domain state. The web/PWA may keep local drafts, caches and offline state, but local state is explicitly labeled and becomes durable only through authorized service contracts.

Docker Compose is a supported composition/development profile. It does not collapse service ownership. The Kubernetes artifacts are a provider-neutral reference rather than a managed-cloud product claim.

## Consequences

- Cross-device experiences have an authoritative server-side state boundary.
- Browser-local data requires explicit migration/reconciliation semantics.
- Operators own deployment infrastructure/secrets and legal/retention obligations for their deployment.
- Service contracts and migrations are first-class product interfaces.
- Local-only/private usage remains possible through self-hosting and local deployment, but is not a separate incompatible product architecture.

## Failure and recovery

If a server dependency is unavailable, the PWA may preserve an explicit local draft but must not claim it is synchronized. Recovery revalidates current server state and resolves conflict explicitly rather than overwriting silently.

## Security and privacy impact

Server persistence increases operator responsibility and attack surface, so tenant isolation, least privilege, purpose-bound access, encrypted secrets, export/deletion controls and private audit evidence are mandatory. It also enables stronger centralized access control and durable audit than unmanaged browser-only state.

## Acceptance evidence

- protected-main README describes multi-user self-hostable SaaS;
- gateway/domain services and PostgreSQL persistence exist;
- identity OAuth/session and tenant isolation tests exist;
- Compose and Kubernetes reference paths exist;
- web code distinguishes local Today drafts from durable records.

## Migration / rollback

Historical local-first and single-app proposals require no data migration because they were design alternatives, not the protected-main system of record. Any actual future browser-local import must remain explicit and idempotent.

## Supersession

Supersede this ADR only if LifeOS intentionally changes its primary authority model (for example to local-first CRDT sync or a hosted single-process architecture) with migration, offline, security, tenancy and rollback evidence.
