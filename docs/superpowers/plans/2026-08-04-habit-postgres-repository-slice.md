# Habit PostgreSQL Repository Slice

## Goal

Persist recurring habit definitions and append-only completion history through a parameterized, tenant-safe PostgreSQL adapter without yet coupling the Habit service to a production runtime pool or HTTP framework.

## Changes

1. Add a PostgreSQL implementation of the asynchronous Habit repository contract.
2. Encode normalized ISO weekdays into the seven-bit database mask and fail closed when persisted recurrence kind, interval, or mask values are inconsistent.
3. Validate UUIDv4 identifiers, IANA timezones, local calendar dates, RFC 3339 timestamps, titles, tenant ownership, lookup identifiers, and result cardinality on every persistence boundary.
4. Bind every write and lookup value and require `workspace_id` in every read predicate.
5. Align habit and completion-history ordering with the deterministic migration indexes.
6. Insert completion events without mutation and recover exact retries only after the named idempotency constraint reports a unique violation.
7. Reject an idempotency-key replay when its scheduled date or completion timestamp differs from the original persisted payload.
8. Convert unrelated database and transport failures into a credential-free persistence error rather than leaking driver details or misclassifying them as idempotent retries.
9. Cover SQL binding, recurrence encoding and decoding, malformed rows, cross-tenant data, missing and duplicate lookups, new completions, exact retries, conflicting retries, safe database errors, and completion ordering.
10. Execute the Habit migration against the CI PostgreSQL service and prove restart durability, tenant isolation, concurrent duplicate serialization, conflicting replay rejection, and database-enforced append-only history.

## Deferred slices

- validated production pool configuration and NestJS shutdown lifecycle wiring;
- versioned HTTP endpoints and credential-free RFC 9457-compatible persistence errors;
- pause, archive, streak, reminder, calendar, and controlled-erasure workflows.

## Validation

Formatting, lint, type checking, unit and pooled PostgreSQL integration tests, build, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and human review must pass on the exact pull-request head.
