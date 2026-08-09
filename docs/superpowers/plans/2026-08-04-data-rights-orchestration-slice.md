# Tenant data-rights orchestration slice

## Goal

Add production-oriented application boundaries for workspace data portability and erasure without allowing a request body to select another tenant or allowing one service to delete data before every participating bounded context is ready.

## Current implementation status

- Protected main now derives data-rights ownership from an authenticated session and preserves the actual authentication instant across session rotation; recent-auth enforcement no longer mistakes a rotated session for fresh authentication.
- `apps/identity-service/src/data-rights.ts` defines the trusted workspace context, contributor contract, deterministic export manifest, fail-closed erasure preflight, idempotent execution context, and post-erasure verification receipt.
- `apps/identity-service/src/data-rights.integration.test.ts` provides boundary evidence for deterministic exports, tenant isolation, secret-field rejection, no mutation during export, no partial deletion after a failed preflight, deterministic erasure order, bounded recovery evidence, and complete absence verification.
- **Implemented on active PR:** `data-rights-request-ledger.ts` and migration `0006_data_rights_request_ledger.sql` persist tenant-bound request identity, exact idempotency replay, request/receipt SHA-256 digests, lifecycle state, and one immutable terminal receipt without retaining a foreign-key dependency that would either erase the receipt or block source identity/workspace erasure.
- The active implementation includes a real PostgreSQL regression proving that a completed erasure receipt remains available after the source workspace and user rows are deleted.

This remains a partial product journey. The durable ledger is intentionally a bounded persistence primitive; it does not by itself claim complete public export/deletion UX, concrete participation by every data-owning service, encrypted export delivery, legal-hold policy, backup-expiry behavior, or operator-visible recovery.

## Trust boundaries

- `workspaceId` and `actorUserId` enter only through `DataRightsWorkspaceContext`, which is built from the authenticated session boundary rather than client-selected ownership fields.
- Sensitive data-rights operations require the configured recent-authentication window before orchestration begins.
- Contributors are registered by application composition, have bounded unique names, and receive only the trusted context plus an idempotency key for destructive execution.
- Contributor export values are normalized to inert JSON, sorted canonically, bounded by depth and byte limits, and rejected when they contain secret-shaped or prototype-pollution keys.
- The export digest covers the schema version, tenant, requesting actor, generation time, ordered contributor sections, and all normalized data.
- The durable request ledger stores only opaque UUIDv4 authority identifiers, request kind, SHA-256 digests, lifecycle timestamps, and status. It does not store exported personal content.

## Durable request and receipt contract

A data-rights request uses one workspace-scoped UUIDv4 idempotency key. The first accepted request persists its opaque request identity, trusted workspace/user identifiers, operation kind, request digest, and request time. An exact replay returns the original durable request. Reusing the same idempotency key with a different actor, operation, or request digest fails closed. Reusing a durable `request_id` for a different request is likewise mapped to the same stable credential-free domain conflict rather than exposing a raw PostgreSQL unique-violation error.

Completion is one-way. A pending request may record one SHA-256 receipt digest and completion instant. Replaying that same receipt is safe; a different terminal digest cannot rewrite prior audit evidence. The ledger intentionally retains opaque workspace/user UUID references after the source rows are erased so completion evidence can survive the operation it proves. Retention duration and subsequent disposal of those audit references remain a separately governed privacy/operability decision.

## Erasure safety

Every contributor must pass preflight before any `eraseWorkspace` method is called. A blocked or malformed preflight fails closed and leaves all contributors untouched. Successful execution is deterministic and supplies the same UUIDv4 idempotency key to every contributor. After execution, every contributor must independently verify that the workspace is absent before a signed-shape SHA-256 receipt is returned.

A dependency failure after destructive execution begins returns only the ordered contributor names that completed. Concrete contributors must therefore implement exact idempotent replay so an operator or durable coordinator can safely retry the same request.

## Follow-up work

1. Wire the authenticated data-rights application and orchestration flow to the durable ledger and expose bounded status resources without accepting ownership fields in JSON.
2. Register concrete identity, planning, habit, AI audit, calendar, review, notification, privacy, and integration contributors.
3. Add immutable operational/audit events, bounded retention/expiry, rate limits, and legal-hold decisions around the request lifecycle.
4. Stream encrypted exports to object storage with short-lived download authorization, explicit download audit, and retention deletion.
5. Define backup-expiry behavior so erased source data cannot be silently reintroduced through unsupported restores.
6. Add cross-service recovery drills proving a failed destructive execution can be safely replayed to completion.

Refs #21, #55, and #58.
