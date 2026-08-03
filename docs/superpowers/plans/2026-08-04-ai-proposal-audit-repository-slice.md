# AI Proposal Audit Repository Slice

## Goal

Persist tenant-scoped AI proposal evidence and explicit accept/reject decisions without giving the AI service any capability to mutate user-owned records.

## Changes

1. Add a forward-only PostgreSQL migration for immutable proposal audit records and append-only decision events.
2. Carry UUIDv4 workspace, proposal, actor, event, and idempotency identifiers through every ownership path.
3. Store normalized proposal requests, bounded model identity, summaries, rationale, inert operations, mandatory-confirmation state, and timestamps.
4. Compute canonical SHA-256 request and proposal-content digests and verify both whenever persisted evidence is read.
5. Require decision events to reference the exact persisted proposal content digest through a tenant-scoped composite foreign key.
6. Recover exact duplicate decisions only after the named idempotency constraint reports a unique violation; reject conflicting replays.
7. Bind every SQL value, scope every lookup by `workspace_id`, validate stored JSON and scalar values, fail closed on malformed rows, and return deterministic ordering.
8. Reject proposal or decision `UPDATE`, `DELETE`, and `TRUNCATE` operations at the database layer.
9. Keep the repository contract audit-only, with no planning, calendar, habit, identity, notification, or user-data command dependency.
10. Add unit and pooled PostgreSQL integration evidence for deterministic digests, tamper detection, restart durability, tenant isolation, concurrent replay serialization, stale-digest rejection, conflicting replay rejection, deterministic reads, and append-only triggers.

## Deferred slices

Validated production pool configuration, NestJS repository wiring, proposal retrieval and decision HTTP routes, authenticated actor derivation, bounded external model transport, and separately authorized proposal execution remain subsequent reviewable work.

## Validation

Formatting, lint, type checking, unit and PostgreSQL integration tests, build, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and human review must pass on the exact pull-request head.
