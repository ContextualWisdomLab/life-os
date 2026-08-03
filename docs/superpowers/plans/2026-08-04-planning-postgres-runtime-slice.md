# Planning PostgreSQL Runtime Slice

## Goal

Promote the Planning service from a process-local adapter to a validated PostgreSQL runtime and prove that tenant-safe data survives restarts and concurrent writes.

## Changes

1. Add a bounded PostgreSQL pool configuration that requires `PLANNING_DATABASE_URL`, accepts only PostgreSQL schemes, and constrains pool size and timeout values.
2. Construct the Planning service from the PostgreSQL repository through a NestJS provider instead of module-level in-memory state.
3. Close the pool idempotently through the NestJS application-shutdown lifecycle.
4. Map unexpected database failures to credential-free RFC 9457-compatible problem details without returning SQL, credentials, stack traces, or configuration.
5. Run both Planning migrations against the CI PostgreSQL service.
6. Prove hierarchy durability across runtime restarts, workspace isolation, cross-tenant rejection, concurrent writes, and stable repeated reads.
7. Add the new runtime, tests, boundary files, and this plan to the formatting gate.

## Configuration

- `PLANNING_DATABASE_URL` is required and must use `postgres:` or `postgresql:`.
- `PLANNING_DATABASE_POOL_MAX` defaults to `10` and is bounded from `1` through `32`.
- `PLANNING_DATABASE_CONNECT_TIMEOUT_MS` defaults to `5000` and is bounded from `100` through `30000`.
- `PLANNING_DATABASE_IDLE_TIMEOUT_MS` defaults to `30000` and is bounded from `1000` through `300000`.

## Deferred slices

- milestone persistence and HTTP endpoints;
- authenticated workspace derivation from the Identity session rather than a caller-supplied header;
- migration execution as a separate deployment job with advisory locking;
- readiness and liveness probes that distinguish process health from database reachability.

## Validation

Formatting, lint, type checking, pooled PostgreSQL integration tests, build, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and human review must pass on the exact pull-request head.
