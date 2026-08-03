# Habit Recurring Domain Slice

## Goal

Establish a tenant-safe recurring-habit kernel that generates bounded local-date occurrences and records immutable, idempotent completion history without coupling the domain to an HTTP framework or database driver.

## Changes

1. Define daily and weekly recurrence contracts with bounded intervals and normalized ISO weekdays.
2. Validate opaque tenant identifiers, UUIDv4 idempotency keys, titles, IANA timezones, calendar dates, timestamps, and bounded occurrence ranges.
3. Generate occurrences from local calendar dates rather than elapsed wall-clock hours so daylight-saving transitions do not duplicate or omit scheduled habits.
4. Add an asynchronous repository boundary and an in-memory adapter that preserves tenant isolation, deterministic ordering, idempotent completion commands, and copy-on-read history.
5. Add parameter-recovery tests across leap day, month and year boundaries, daylight-saving transition dates, recurrence intervals, malformed input, cross-workspace access, replayed completion commands, and unscheduled dates.
6. Add a PostgreSQL schema with UUIDv4 checks, composite tenant ownership, a normalized weekly bit mask, deterministic indexes, idempotency uniqueness, and an append-only completion-event trigger.
7. Document migration integrity, rollback risk, and the future controlled-erasure requirement.

## Deferred slices

- parameterized PostgreSQL repository implementation and pooled integration tests;
- validated PostgreSQL runtime and NestJS lifecycle wiring;
- versioned HTTP endpoints with RFC 9457-compatible problem details;
- pause, archive, streak, reminder, and calendar-integration workflows;
- separately authorized data-rights erasure that remains unavailable to ordinary application roles.

## Validation

Formatting, lint, type checking, recurrence tests, build, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and human review must pass on the exact pull-request head.
