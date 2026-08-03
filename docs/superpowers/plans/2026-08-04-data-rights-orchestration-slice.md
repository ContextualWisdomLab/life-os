# Tenant data-rights orchestration slice

## Goal

Add the first production-oriented application boundary for workspace data portability and erasure without allowing a request body to select another tenant or allowing one service to delete data before every participating bounded context is ready.

## Scope

- `apps/identity-service/src/data-rights.ts` defines the trusted workspace context, contributor contract, deterministic export manifest, fail-closed erasure preflight, idempotent execution context, and post-erasure verification receipt.
- `apps/identity-service/src/data-rights.integration.test.ts` provides boundary evidence for deterministic exports, tenant isolation, secret-field rejection, no mutation during export, no partial deletion after a failed preflight, deterministic erasure order, bounded recovery evidence, and complete absence verification.

This slice intentionally does not expose a public HTTP route or claim production deletion support. A later slice must derive the actor and workspace from an authenticated session, register concrete contributors for every data-owning service, persist request state, and provide user-visible status and download workflows.

## Trust boundaries

- `workspaceId` and `actorUserId` enter only through `DataRightsWorkspaceContext`, which is expected to be built by the authenticated gateway or session layer. Contributor payloads cannot override either value.
- Contributors are registered by application composition, have bounded unique names, and receive only the trusted context plus an idempotency key for destructive execution.
- Export values are normalized to inert JSON, sorted canonically, bounded by depth and byte limits, and rejected when they contain secret-shaped or prototype-pollution keys.
- The export digest covers the schema version, tenant, requesting actor, generation time, ordered contributor sections, and all normalized data.

## Erasure safety

Every contributor must pass preflight before any `eraseWorkspace` method is called. A blocked or malformed preflight fails closed and leaves all contributors untouched. Successful execution is deterministic and supplies the same UUIDv4 idempotency key to every contributor. After execution, every contributor must independently verify that the workspace is absent before a signed-shape SHA-256 receipt is returned.

A dependency failure after destructive execution begins returns only the ordered contributor names that completed. Concrete contributors must therefore implement exact idempotent replay so an operator or durable coordinator can safely retry the same request.

## Follow-up work

1. Add authenticated HTTP commands and status resources without accepting ownership fields in JSON.
2. Add a durable request ledger with immutable audit events, expiry, rate limits, and legal-hold decisions.
3. Register concrete identity, planning, habit, AI audit, calendar, review, notification, and integration contributors.
4. Stream encrypted exports to object storage with short-lived download authorization and explicit retention deletion.
5. Add cross-service recovery drills proving a failed execution can be safely replayed to completion.

Refs #21 and #58.
