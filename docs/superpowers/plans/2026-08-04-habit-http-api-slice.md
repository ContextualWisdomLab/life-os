# Habit HTTP API Slice

## Goal

Expose the durable recurring-habit domain through a versioned, tenant-scoped NestJS API backed by the validated PostgreSQL repository and a bounded production runtime.

## Changes

1. Validate `HABIT_DATABASE_URL`, pool size, connection timeout, and idle timeout before constructing node-postgres.
2. Own the PostgreSQL pool through a NestJS lifecycle provider and close it exactly once during application shutdown.
3. Bind `PostgresHabitRepository` and `HabitService` into the production application module without an in-memory fallback.
4. Expose versioned routes for habit creation and listing, generated occurrences, idempotent completion commands, and immutable completion history.
5. Derive tenant ownership exclusively from the `x-workspace-id` header and validate workspace, habit, and idempotency identifiers as UUIDv4 at their relevant boundaries.
6. Parse untrusted request bodies without accepting workspace ownership from JSON and reject malformed recurrence shapes before reaching persistence.
7. Map validation, missing-record, idempotency-conflict, persistence, and unknown failures to bounded problem details without SQL, connection, or credential leakage.
8. Exercise the production module over HTTP and disposable PostgreSQL for tenant isolation, deterministic recurrence generation, exact completion replay, conflicting replay rejection, restart durability, invalid ownership, and credential-free database failures.

## Routes

- `POST /v1/habits`
- `GET /v1/habits`
- `GET /v1/habits/:habitId/occurrences?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `POST /v1/habits/:habitId/completions`
- `GET /v1/habits/:habitId/completions`
- `GET /v1/health`

## Deferred slices

Authenticated workspace derivation at an API gateway, pause/archive, streak projections, reminders, calendar integration, controlled erasure, and end-user workflow design remain separately reviewable work.

## Validation

Formatting, lint, type checking, unit tests, production-module HTTP/PostgreSQL integration tests, build, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and human review must pass on the exact pull-request head.
