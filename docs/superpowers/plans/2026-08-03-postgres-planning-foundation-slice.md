# PostgreSQL planning foundation slice

## Objective

Replace the planning domain's process-local repository assumption with an asynchronous persistence boundary and add a tenant-safe PostgreSQL adapter without changing the public HTTP surface.

## Included

- asynchronous planning repository and application-service contracts
- compatible in-memory behavior for unit tests and local development
- parameterized PostgreSQL persistence for goals, projects, and tasks
- fail-closed validation for UUIDv4 identifiers, timestamps, task status, and parent workspace ownership
- workspace-scoped reads with deterministic creation ordering
- schema hardening for UUIDv4 identifiers and query-aligned indexes
- unit evidence for SQL binding, tenant scoping, row validation, duplicate lookup rejection, and deterministic ordering

## Security and data guarantees

- every dynamic SQL value is passed as a bound parameter
- project and task reads join through their workspace-bound parent
- malformed or cross-workspace stored relationships fail closed
- internal and workspace identifiers accepted by the PostgreSQL adapter are UUIDv4 strings
- no database diagnostics or credentials are introduced into HTTP responses

## Follow-up

The next slice will wire a validated PostgreSQL pool into the NestJS runtime, apply migrations in integration tests, verify restart durability and concurrent writes, and close the pool through the shutdown lifecycle.

## Validation gate

Merge only when CI, AppGuardrail, SAST Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and all human or security review feedback pass on the exact head with no unresolved actionable findings.

Part of #31.
