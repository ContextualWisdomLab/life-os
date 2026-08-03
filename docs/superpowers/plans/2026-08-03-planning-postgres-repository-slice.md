# Planning PostgreSQL Repository Slice

## Goal

Move the Planning domain behind an asynchronous repository boundary and add a tenant-safe PostgreSQL adapter without changing the existing in-memory behavior.

## Changes

1. Convert all Planning repository and application methods to asynchronous contracts suitable for durable I/O.
2. Keep the in-memory adapter as the default runtime dependency while preserving workspace isolation and creation-order results.
3. Add a parameterized PostgreSQL repository for goals, projects, and tasks.
4. Validate UUIDv4 identifiers, timestamps, status values, ownership, and parent linkage on every row returned from PostgreSQL.
5. Add a forward migration for composite task ownership and deterministic creation-order indexes.
6. Cover SQL binding, tenant predicates, row validation, ordering, empty lookups, and impossible duplicate lookups.

## Deferred slices

- validated PostgreSQL pool configuration and NestJS lifecycle wiring;
- pooled integration tests for restart durability and concurrent writes;
- milestones and RFC 9457 persistence failure responses.

## Validation

Formatting, lint, type checking, tests, build, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and human review must pass on the exact pull-request head.
