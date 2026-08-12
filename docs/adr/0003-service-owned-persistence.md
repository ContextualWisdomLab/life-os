# ADR 0003: Domain-oriented service-owned persistence

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context
LifeOS evolved from a simple app concept into independently runnable bounded services. A shared database authority would make those boundaries nominal and increase tenant, migration and deployment coupling.

## Decision drivers
Independent operation, modular MSA composition, least privilege, migration ownership, fault isolation, explicit versioned interoperability.

## Alternatives considered
- shared tables/read access across services — rejected;
- one monolithic persistence layer — rejected as durable architecture;
- service-owned persistence with API/event/saga/plugin contracts — selected.

## Decision
Each bounded service owns its persistence adapters, migrations and database credentials. Services never read or mutate another service's tables directly. Shared UUIDs are logical references only. Cross-service effects use versioned HTTP/event/saga/plugin contracts.

## Consequences
More explicit integration contracts and eventual-consistency handling are required, but services remain independently deployable/testable and database privileges can be least-privilege.

## Failure and recovery
A service/database outage fails only the affected authority where possible. Cross-service workflows retain idempotency/reconciliation evidence rather than bypassing ownership with emergency SQL.

## Security and privacy impact
Compromise of one service credential must not imply access to every domain table. Tenant authorization remains enforced by the owning service.

## Acceptance evidence
Protected-main service layout, per-service migrations/repositories and architecture tests; logical data model labels ownership explicitly.

## Migration and rollback
Any shared-table legacy coupling must be inventoried and replaced with a versioned contract before privileges are removed. Rollback preserves service-owned authority.

## Supersession
Only a reviewed repository-wide data-authority ADR with migration/security/operability evidence may supersede this decision.