# ADR-0003: Domain-oriented service and data ownership

**Status:** Accepted architecture  
**Date:** 2026-08-09

## Context

LifeOS contains strongly related planning, habit, review, notification, identity, integration, AI and privacy capabilities. A shared database or arbitrary service-to-service table access would make tenancy, migrations, incident containment and independent deployment difficult to reason about.

## Drivers

- explicit business authority;
- tenant isolation;
- independent migrations/tests/runtime;
- replaceable service implementations;
- safe event/API evolution;
- bounded failure and rollback.

## Alternatives

1. Shared relational schema with cross-service joins/writes.
2. One service per entity regardless of consistency boundary.
3. Domain-oriented bounded services with owned persistence and versioned contracts.

## Decision

Use domain-oriented bounded services. Each service owns its persistence, migrations, runtime configuration, observability and shutdown behavior. Cross-service interaction uses versioned HTTP, event, saga, plugin or MCP contracts. Direct cross-service table reads/writes are prohibited.

Planning keeps goals/projects/milestones/tasks together while they form one consistency boundary; splitting is driven by measured ownership/load, not entity count.

## Consequences

- Duplicate/projection data may exist where needed for read models.
- Cross-service workflows require explicit idempotency and failure handling.
- Logical ERD links are not physical foreign-key authority.
- Local Compose may run one PostgreSQL cluster while retaining schema/credential ownership.

## Failure/recovery

When a dependency is unavailable, the caller returns/defer/compensates according to its contract rather than directly repairing another service's tables. Event consumers are idempotent under replay.

## Security/privacy impact

Separate authority limits blast radius and supports minimum database privileges. Shared IDs are correlation values, not authorization.

## Acceptance evidence

`ARCHITECTURE.md`, `AGENTS.md`, service-specific repositories/migrations, PostgreSQL integration tests and versioned integration/plugin boundaries.

## Migration/rollback

Moving ownership requires a dedicated migration/saga plan, dual-read/write only when explicitly bounded, reconciliation evidence and removal of the old authority after cutover.

## Supersession

Requires evidence that another ownership model improves reliability/product delivery without weakening tenancy, migration safety or independent operation.
