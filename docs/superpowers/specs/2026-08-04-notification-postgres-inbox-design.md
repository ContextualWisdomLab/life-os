# Durable notification claims and in-app inbox design

**Date:** 2026-08-04  
**Status:** Approved for the `notifications.reminders` durability slice  
**Tracking issue:** #103

## Product objective

Reminder occurrences survive process restarts, multiple notification workers share one atomic claim boundary, and accepted in-app deliveries remain durable and idempotent. This slice strengthens the existing scheduler without adding external channels, user credentials, or a browser-facing API.

## Bounded-context architecture

`apps/notification-service` remains independently deployable and depends on no other LifeOS database. It owns a dedicated `notification_service` PostgreSQL schema and the following multi-word snake_case objects:

- `reminder_occurrences`: one UUIDv4 occurrence, policy, retry state, and expiring claim;
- `reminder_outcomes`: immutable delivered, deferred, and failed scheduler evidence;
- `inbox_messages`: credential-free in-app delivery evidence keyed by an idempotency digest.

Every table, column, index, constraint, and schema identifier contains at least two snake_case words. The service neither discovers tables dynamically nor reads another service's schema.

## Persistence contract

The concrete `PostgresReminderRepository` implements the existing `ReminderRepository` port. SQL structure and identifiers are static; all values are bound parameters. Repository rows are treated as untrusted and are normalized through the scheduler's existing UUIDv4, title, instant, time-zone, quiet-hours, limit, and attempt validators before being returned.

The repository also exposes bounded service-facing methods to create an occurrence and list tenant reminders, outcomes, and inbox messages. Returned arrays are capped, deterministically ordered, cloned, and tenant-scoped.

## Atomic claims and recovery

`claim` hashes the scheduler idempotency key with SHA-256 and performs one conditional `UPDATE ... RETURNING`. A claim succeeds only when the occurrence is pending and its prior lease is absent or expired. The lease duration is fixed and bounded in the repository constructor. Concurrent workers may observe the same due row, but only one conditional update succeeds.

Completion statements use data-modifying common table expressions so the occurrence transition and immutable outcome insertion succeed or fail as one PostgreSQL statement. Retryable deferrals and failures clear the claim; terminal delivered and attempt-limit outcomes retain terminal state. An expired claim is recoverable by another worker.

PostgreSQL documents `SKIP LOCKED` as suitable for queue-like consumers but as an intentionally inconsistent view. This design does not depend on a long-lived selection lock: listing is advisory and the conditional claim update is authoritative.

## In-app delivery idempotency

`PostgresInAppDeliveryGateway` hashes the raw composite idempotency key before storage. It inserts one UUIDv4 `inbox_messages` row with `ON CONFLICT DO NOTHING`, then verifies an existing conflict represents the same workspace, reminder, title, due instant, and time zone. A provider-success/persistence-failure retry therefore cannot create a duplicate or silently alias a different message.

No cookie, bearer value, provider token, arbitrary URL, exception text, or raw composite idempotency key is stored or returned.

## Data model invariants

- all internal IDs are UUIDv4 values;
- reminder titles are non-empty, trimmed, bounded, and control-character free;
- timestamps are `timestamptz` and normalized to RFC 3339 UTC strings at the TypeScript boundary;
- quiet-hour endpoints are both null or both bounded minute-of-day integers and must differ;
- daily limits are 1–20 and attempts are 0–3;
- status and outcome values are constrained enums;
- claim and idempotency hashes are exactly 32 bytes;
- retryable transitions require a next instant, terminal transitions prohibit one;
- tenant reads always include `workspace_id` in the predicate.

## Runtime boundary

`NotificationRuntime` owns one bounded PostgreSQL pool, the concrete repository, the in-app gateway, and the existing scheduler. Configuration accepts only PostgreSQL URLs and bounded pool/timeout values. Shutdown closes the pool exactly once. Scheduler leadership and process-level intervals remain a separate operational slice; database claims make concurrent invocations safe.

## Test evidence

- unit tests inspect fixed parameterized SQL, hash behavior, row validation, response bounds, and runtime configuration;
- real PostgreSQL tests apply the migration and prove restart durability, deterministic due ordering, concurrent claim exclusion, lease recovery, tenant isolation, exact in-app replay, conflict rejection, delivered counts, deferral, retry, and terminal outcomes;
- existing scheduler integration evidence remains unchanged and includes the verified 72-hour policy horizon through a three-hour IANA fallback.

## Deferred scope

- browser/gateway reminder commands and inbox routes;
- automatic process scheduling and distributed leadership;
- external email, SMS, push, or webhook adapters;
- encrypted channel credentials and per-user preferences;
- planning/habit outbox ingestion;
- read/unread mutations and notification retention policy.

## Primary references

- PostgreSQL current documentation: transactions, row locks, queue-like `SKIP LOCKED`, data-modifying common table expressions, and `INSERT ... ON CONFLICT`;
- RFC 3339, *Date and Time on the Internet: Timestamps*;
- IANA Time Zone Database and ECMA-402 named-time-zone projection.
