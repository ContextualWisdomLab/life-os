# AI proposal-audit migrations

Apply AI service SQL files in lexical order to the PostgreSQL database owned by the AI service before starting the corresponding application version.

- `0001_proposal_audit.sql` creates immutable tenant-scoped proposal evidence and append-only accept/reject decision events.

## Trust boundary

The audit schema stores only validated proposal requests, model identity, inert proposed operations, explanatory rationale, canonical SHA-256 digests, timestamps, and explicit user decisions. It has no foreign key, repository dependency, database privilege, or command surface for planning, calendar, habit, identity, notification, or other user-owned state mutation.

Every proposal, workspace, decision, actor, and idempotency identifier is constrained to UUIDv4. Decision ownership carries `(proposal_id, workspace_id, proposal_content_digest)` through a composite foreign key so an accept/reject event cannot silently target another tenant or a stale proposal revision.

## Integrity and idempotency

`request_digest` is computed from the normalized tenant-scoped proposal request. `content_digest` is computed from immutable proposal provenance and content, including the model identifier, request digest, rationale, proposed operations, confirmation requirement, and proposal creation timestamp. The repository recomputes and verifies both digests on every read.

Decision commands are idempotent by `(workspace_id, proposal_id, idempotency_key)`. Exact replays return the original event. Reuse with another digest, actor, decision, reason, or decision timestamp is rejected. A decision whose expected content digest is not the persisted proposal revision fails closed.

## Runtime privileges

The application runtime role should receive only `SELECT` and `INSERT` on `ai.proposal_audit_records` and `ai.proposal_decision_events`, plus sequence privileges if a future migration introduces sequences. Do not grant `UPDATE`, `DELETE`, or `TRUNCATE` on either table.

Database triggers reject `UPDATE`, `DELETE`, and `TRUNCATE` even for overly broad roles. A separately authorized, audited data-rights erasure migration is required before production account deletion is enabled; application code must not bypass the append-only audit ledger.

## Validation evidence

CI supplies `AI_DATABASE_URL`, applies the migration to a disposable PostgreSQL service, and verifies restart durability, deterministic reads, tenant isolation, concurrent exact decision replay, stale-digest rejection, conflicting replay rejection, and append-only enforcement. All SQL values are parameterized and stored JSON is treated as untrusted evidence on read.

## Rollback

This migration is forward-only in automated environments. An operator-approved rollback must export and verify proposal and decision evidence before dropping `ai.proposal_decision_events`, `ai.proposal_audit_records`, `ai.reject_proposal_audit_mutation()`, and the `ai` schema. Do not roll back after recording production decisions unless legal, retention, and audit requirements have been reviewed and documented.
