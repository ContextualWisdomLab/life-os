# AI proposal-audit migrations

Apply AI service SQL files in lexical order to the PostgreSQL database owned by the AI service before starting the corresponding application version.

- `0001_proposal_audit.sql` creates immutable tenant-scoped proposal evidence and append-only accept/reject decision events.

## Production runtime

The production module requires `AI_DATABASE_URL` and accepts bounded optional pool controls:

- `AI_DATABASE_POOL_MAX`: integer from 1 through 32; default `10`
- `AI_DATABASE_CONNECT_TIMEOUT_MS`: integer from 100 through 30000; default `5000`
- `AI_DATABASE_IDLE_TIMEOUT_MS`: integer from 1000 through 300000; default `30000`

The node-postgres pool identifies itself as `life-os-ai-service`, records idle-client failures through a credential-free listener, and is closed exactly once after successful cleanup through the NestJS application-shutdown lifecycle. Concurrent shutdown calls share one attempt; a failed attempt remains visible and permits a later retry. Startup fails closed when the URL is missing, oversized, malformed, or not PostgreSQL.

## Versioned audit routes

The production module exposes the inert proposal-generation route together with tenant-scoped audit history:

- `POST /v1/proposals`
- `GET /v1/proposals`
- `GET /v1/proposals/:proposalId`
- `GET /v1/proposals/:proposalId/decisions`
- `POST /v1/proposals/:proposalId/decisions`

Every route derives workspace scope only from `x-workspace-id`. Decision append additionally requires `x-actor-id` and a closed JSON body containing `expectedContentDigest`, `idempotencyKey`, `decision`, optional `reason`, and `decidedAt`. Workspace and actor identifiers are trusted only when supplied by an authenticated gateway; direct public exposure of the AI service is not supported.

There is deliberately no apply, execute, command, or user-data mutation route. Proposal generation persists the complete verified audit record before returning the proposal. Validation, not-found, stale-digest, conflicting replay, persistence, and unknown failures are mapped to bounded credential-free problem details.

## Trust boundary

The audit schema stores only validated proposal requests, model identity, inert proposed operations, explanatory rationale, canonical SHA-256 digests, timestamps, and explicit user decisions. It has no foreign key, repository dependency, database privilege, or command surface for planning, calendar, habit, identity, notification, or other user-owned state mutation.

Every proposal, workspace, decision, actor, and idempotency identifier is constrained to UUIDv4. Decision ownership carries `(proposal_id, workspace_id, proposal_content_digest)` through a composite foreign key so an accept/reject event cannot silently target another tenant or a stale proposal revision.

## Integrity and idempotency

`request_digest` is computed from the normalized tenant-scoped proposal request. `content_digest` is computed from immutable proposal provenance and content, including the model identifier, request digest, rationale, proposed operations, confirmation requirement, and proposal creation timestamp. The repository recomputes and verifies both digests on every read.

Decision commands are idempotent by `(workspace_id, proposal_id, idempotency_key)`. Exact replays return the original event. Reuse with another digest, actor, decision, reason, or decision timestamp is rejected. A decision whose expected content digest is not the persisted proposal revision fails closed.

## Runtime privileges

The application runtime role should receive only `SELECT` and `INSERT` on `ai.proposal_audit_records` and `ai.proposal_decision_events`, plus sequence privileges if a future migration introduces sequences. Do not grant `UPDATE`, `DELETE`, or `TRUNCATE` on either table.

Database triggers reject `UPDATE`, `DELETE`, and `TRUNCATE` even for overly broad roles. A separately authorized, audited data-rights erasure migration is required before production account deletion is enabled; application code must not bypass the append-only audit ledger.

## Integration-test safety

Destructive schema setup is permitted only through `AI_TEST_DATABASE_URL`. The URL must use PostgreSQL and its database name must contain `test`; otherwise the integration suite fails closed before opening an administrative pool. The suite temporarily points the application runtime at that disposable database and restores the original `AI_DATABASE_URL` after cleanup. Never set `AI_TEST_DATABASE_URL` to a shared development, staging, or production database.

## Validation evidence

CI supplies separate application and disposable-test variables, applies the migration to an ephemeral PostgreSQL service, and verifies restart durability, deterministic reads, tenant isolation, exact decision replay, stale-digest rejection, conflicting replay rejection, append-only enforcement, bounded runtime configuration, retryable exactly-once successful shutdown, idle-client error handling, and the absence of proposal execution routes. All SQL values are parameterized and stored JSON is treated as untrusted evidence on read.

## Deferred work

Authenticated workspace and actor derivation belongs at the gateway. External model transport, prompt and context redaction, policy evaluation, model-quality evaluation, and separately authorized action execution remain independent reviewed capabilities. The audit service must not gain planning, calendar, habit, identity, notification, or generic command dependencies when those slices are added.

## Rollback

This migration is forward-only in automated environments. An operator-approved rollback must export and verify proposal and decision evidence before dropping `ai.proposal_decision_events`, `ai.proposal_audit_records`, `ai.reject_proposal_audit_mutation()`, and the `ai` schema. Do not roll back after recording production decisions unless legal, retention, and audit requirements have been reviewed and documented.
