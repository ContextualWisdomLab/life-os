# ADR 0003: Domain-oriented service data ownership

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context

LifeOS evolved from an early single-application/Compose direction into independently bounded identity, planning, habit, review, notification, calendar, AI, privacy and integration services. Shared physical infrastructure must not become hidden shared-domain authority.

## Decision drivers

- independent service evolution and testing;
- tenant/security blast-radius containment;
- explicit versioned integration contracts;
- self-hosted portability;
- migration/recovery ownership.

## Considered alternatives

1. One shared application/database authority — rejected as the durable architecture.
2. Shared tables with informal ownership — rejected because coupling is hidden and privilege boundaries collapse.
3. Domain-owned persistence with APIs/events/sagas — selected.

## Decision

Each bounded service owns its migrations, persistence adapters, database credentials, runtime configuration, tests and failure semantics. No service directly reads or mutates another service's tables. Cross-service effects use explicit versioned HTTP/event/saga/plugin contracts. Physical PostgreSQL co-location is allowed only if roles/schema privileges preserve logical ownership.

## Consequences

- cross-domain workflows need explicit coordination and reconciliation;
- some read models/projections may duplicate data intentionally;
- operators manage more credentials/migrations;
- service internals can change without exposing their tables as public contracts.

## Failure and recovery

A partial cross-service workflow reports/reconciles explicit participant state; it must not repair itself through hidden table writes. Service migration failure is owned by that service and does not justify cross-service SQL surgery.

## Security and privacy impact

Compromise/misconfiguration of one service credential should not automatically grant every domain store. Tenant and purpose authorization remains enforced at service boundaries.

## Acceptance evidence

Protected main has separate service migration directories/repositories and root architecture rules prohibiting direct cross-service table access.

## Migration and rollback

Any legacy/shared-table coupling discovered during implementation must be replaced behind a reviewed contract before the old access path is removed. Rollback preserves contract compatibility rather than reintroducing hidden DB coupling.

## Supersession

This ADR supersedes the early single-application database-authority interpretation while preserving Compose as a deployment/composition profile.