# Habit PostgreSQL Runtime and HTTP Slice

## Goal

Promote the recurring-habit kernel from a repository library to a production-wired NestJS service with validated PostgreSQL configuration and a bounded tenant-scoped HTTP workflow.

## Changes

1. Require `HABIT_DATABASE_URL` with a PostgreSQL scheme and validate bounded pool size, connection timeout, and idle timeout settings before creating network resources.
2. Construct `HabitService` from `PostgresHabitRepository` through a NestJS provider and remove process-local storage from production startup.
3. Close the PostgreSQL pool idempotently through NestJS application-shutdown lifecycle hooks.
4. Expose versioned endpoints to create and list habits, generate bounded occurrences, append idempotent completion events, and read immutable completion history.
5. Require UUIDv4 workspace and habit identifiers at the HTTP boundary and reject unknown request fields, malformed recurrence discriminators, invalid date shapes, invalid timestamps, and invalid idempotency keys.
6. Map not-found, validation, idempotency-conflict, persistence, and unexpected failures to credential-free RFC 9457-compatible problem details.
7. Cover runtime configuration, shutdown behavior, request parsing, safe error mapping, tenant isolation, occurrence generation, exact completion replay, and completion-history reads.

## Configuration

- `HABIT_DATABASE_URL` is required and must use `postgres:` or `postgresql:`.
- `HABIT_DATABASE_POOL_MAX` defaults to `10` and is bounded from `1` through `32`.
- `HABIT_DATABASE_CONNECT_TIMEOUT_MS` defaults to `5000` and is bounded from `100` through `30000`.
- `HABIT_DATABASE_IDLE_TIMEOUT_MS` defaults to `30000` and is bounded from `1000` through `300000`.

## HTTP surface

- `POST /v1/habits`
- `GET /v1/habits`
- `GET /v1/habits/:habitId/occurrences?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `POST /v1/habits/:habitId/completions`
- `GET /v1/habits/:habitId/completions`

Every business endpoint requires `x-workspace-id` as a UUIDv4. This header is a temporary Phase 1 tenant boundary; a later slice must derive workspace authorization from the authenticated Identity session.

## Deferred slices

- authenticated workspace derivation and authorization policy enforcement;
- database-aware readiness probes and deployment-time migration locking;
- pause, archive, streak, reminder, calendar, and controlled-erasure workflows;
- end-to-end HTTP tests through a real network listener and production deployment manifests.

## Validation

Formatting, lint, type checking, unit tests, build, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and human review must pass on the exact pull-request head.
