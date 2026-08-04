# Bounded reminder scheduler slice

## Goal

Establish the first production-shaped `notifications.reminders` boundary without introducing provider credentials, hidden tenant derivation, or an unbounded background worker.

## Scope

The notification service accepts reminder occurrences from a repository port, validates every untrusted record, and processes at most 100 records per scheduler iteration. Each occurrence carries an opaque UUIDv4 reminder identifier, an opaque UUIDv4 workspace identifier, a bounded user-authored title, an absolute due instant, an IANA time zone, optional local quiet hours, a per-local-day delivery limit, and a bounded attempt count.

Before delivery, the scheduler obtains an atomic tenant-scoped claim keyed by workspace, reminder, and normalized occurrence instant. Concurrent workers therefore cannot deliver the same occurrence twice. The same key is passed to the provider adapter, which must implement idempotent delivery so a provider success followed by a persistence failure remains retry-safe.

## Time-zone and fatigue policy

Quiet hours are evaluated from the current absolute instant using `Intl.DateTimeFormat` and the reminder's IANA time zone. Deferral searches absolute minutes until it reaches the first permitted local minute, which preserves correctness across offset transitions, missing wall-clock times, and repeated wall-clock times. A 72-hour hard limit covers the next local date, a nearly full-day quiet interval, and large IANA offset discontinuities while keeping every scheduler evaluation bounded.

Per-day limits are keyed by workspace and local calendar date. Once the configured limit is reached, the occurrence is deferred to the first permitted minute of the next local date. Limits are bounded from one to twenty deliveries per local day.

## Failure boundary

The scheduler records only stable failure reasons: `delivery_failed` and `attempt_limit`. Provider exceptions and credentials are never copied into outcomes. Retry times use a bounded five-minute linear backoff and stop after three attempts. Repositories are responsible for atomically releasing retryable claims, retaining terminal claims, and persisting the next due instant.

## Deferred work

This slice intentionally does not add PostgreSQL tables, an outbox, scheduler leadership, planning or habit event ingestion, provider credentials, user preference HTTP routes, channel selection, or externally delivered notifications. Those capabilities require separate reviewable slices with authenticated ownership, encryption, operational leases, observability, and concrete delivery receipts.

## Verification

- unit coverage validates UUIDs, titles, instants, time zones, quiet hours, limits, attempts, and scheduler batch bounds
- integration coverage proves concurrent duplicate prevention, tenant-isolated daily counts, DST fallback deferral, next-local-day fatigue deferral, bounded credential-free retries, terminal attempt limits, and untrusted repository bounds
- CI must pass formatting, lint, type checking, tests, build, Compose validation, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, and all review gates on the exact PR head

Refs #21 and #98.
