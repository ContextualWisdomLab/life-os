# Notification persistence operations

## Purpose

The notification service owns the `notification_service` PostgreSQL schema. The schema persists reminder occurrences, expiring worker claims, immutable scheduler outcomes, and credential-free in-app inbox messages. It is an independent bounded context and must not read or mutate another service's tables.

This design provides at-least-once scheduler execution with atomic claims and idempotent delivery evidence. It does not claim distributed exactly-once execution. Safe replay depends on the repository transition checks and the in-app gateway's persisted SHA-256 idempotency digest.

## Migration

Apply `apps/notification-service/migrations/0001_durable_reminder_inbox.sql` before starting a runtime that uses `PostgresReminderRepository`.

The migration creates:

- `notification_service.reminder_occurrences` for policy, attempts, and lease state;
- `notification_service.reminder_outcomes` for immutable delivery, deferral, and failure evidence;
- `notification_service.inbox_messages` for durable in-app messages;
- bounded indexes for due work, expired claims, tenant reads, delivered-date counts, and idempotency;
- mutation guards that reject update, delete, and truncate operations against outcome history with SQLSTATE `55000`.

Run the migration through the normal release migration job using a role with schema DDL rights. The application role should receive only the table and sequence privileges required by the repository. Do not grant the application role ownership of the schema or the mutation-guard function.

Before rollout, verify that the target database is PostgreSQL 16 or a compatibility-tested later release and that the connection uses TLS outside a private development environment.

## Runtime configuration

The service validates all configuration before allocating a pool.

| Variable                                   | Default | Accepted boundary                         |
| ------------------------------------------ | ------: | ----------------------------------------- |
| `NOTIFICATION_DATABASE_URL`                |    none | required `postgres:` or `postgresql:` URL |
| `NOTIFICATION_DATABASE_POOL_MAX`           |    `10` | integer `1`–`32`                          |
| `NOTIFICATION_DATABASE_CONNECT_TIMEOUT_MS` |  `5000` | integer `100`–`30000`                     |
| `NOTIFICATION_DATABASE_IDLE_TIMEOUT_MS`    | `30000` | integer `1000`–`300000`                   |
| `NOTIFICATION_CLAIM_LEASE_SECONDS`         |   `300` | integer `30`–`3600`                       |
| `NOTIFICATION_REMINDER_BATCH_SIZE`         |    `50` | integer `1`–`100`                         |

The pool sets `application_name` to `life-os-notification-service`. Use this value to distinguish service connections in PostgreSQL activity and connection metrics.

## Claim and recovery model

Due-row selection is advisory. The authoritative ownership boundary is one tenant-scoped conditional update that writes a SHA-256 digest of a unique per-attempt claim token and a bounded expiration time.

A worker may process an occurrence only when its claim update returns a unique opaque claim token. Concurrent workers can observe the same due row, but only one unexpired claim succeeds.

If a worker exits after claiming but before a terminal transition, another worker can claim the occurrence after `claim_expires_at`. Operators should not clear active claims manually during normal operation. For urgent recovery, first confirm that the original worker is no longer running and that no delivery provider request remains in flight. Prefer waiting for the bounded lease to expire.

To inspect overdue pending work without exposing message text, use an aggregate query such as:

```sql
SELECT
  count(*) AS overdue_reminder_count,
  min(due_instant) AS oldest_due_instant
FROM notification_service.reminder_occurrences
WHERE occurrence_status = 'pending'
  AND due_instant <= clock_timestamp();
```

To inspect expired claims:

```sql
SELECT count(*) AS expired_claim_count
FROM notification_service.reminder_occurrences
WHERE occurrence_status = 'pending'
  AND claim_key_hash IS NOT NULL
  AND claim_expires_at <= clock_timestamp();
```

Do not log `reminder_title`, raw idempotency keys, database URLs, or provider credentials while investigating claims.

## Delivery replay

The in-app gateway stores only a 32-byte SHA-256 digest of the composite idempotency key. A repeated insert is accepted only when the persisted workspace, reminder, title, due instant, and time zone match the attempted message.

Claim tokens are separate from stable delivery idempotency keys, and every transition requires both the exact token digest and an unexpired lease. A mismatched replay raises `NotificationReplayConflictError` and must be treated as an integrity incident. Do not delete the existing inbox row to force the retry through. Preserve the row and the corresponding occurrence for investigation.

A provider success followed by a repository failure can therefore be retried safely: the inbox insert resolves as an exact replay, and the repository can complete the terminal occurrence transition after reacquiring an expired lease.

## Outcome integrity

Every delivered, deferred, retryable-failed, or terminal-failed transition is written in the same PostgreSQL statement as the corresponding occurrence mutation. The statement fails closed unless the worker owns the exact claim digest and the occurrence still has the expected due instant and attempt count.

Outcome history is append-only. Direct update, delete, and truncate operations are rejected. Administrative corrections must be represented as a new, separately reviewed migration or compensating evidence record; never disable the mutation guard in place.

## Privacy and security boundaries

The persistence layer stores reminder titles and scheduling metadata because they are required to render the in-app inbox. It does not store cookies, bearer tokens, provider authorization values, arbitrary callback URLs, raw idempotency keys, or exception text.

Operational controls should include:

- encrypted database transport and encrypted storage;
- least-privilege application and migration roles;
- tenant-scoped repository methods with fixed parameterized SQL;
- database backups and restore tests that include the `notification_service` schema;
- restricted access to inbox content and query logs;
- retention and deletion policy approval before exposing user-facing history controls.

Database statement logging can capture bound reminder titles depending on PostgreSQL and proxy configuration. Keep production statement logging at a privacy-reviewed level and prohibit query logging in application error payloads.

## Rollback boundary

Application rollback is safe only while the prior version can ignore the new schema. Do not roll back the schema destructively while any runtime may still use it.

The forward migration has no automatic down migration because reminder outcomes and inbox messages are durable user evidence. A rollback should:

1. stop new notification scheduling and delivery;
2. drain or terminate notification workers;
3. deploy the prior application version;
4. retain the `notification_service` schema intact;
5. verify no prior process attempts incompatible writes;
6. prepare a separately reviewed forward repair migration.

Dropping the schema is destructive and is permitted only in disposable development or test databases. Production removal requires an approved retention/export plan, verified backups, and an explicit maintenance change.

## Verification after deployment

Verify all of the following on the deployed release:

- the migration completed once without partial objects;
- the application pool is bounded and identified by `application_name`;
- one due occurrence produces one successful claim;
- an expired test claim can be recovered;
- one exact replay produces one inbox message;
- tenant-scoped reads never return another workspace's records;
- outcome mutation attempts fail with SQLSTATE `55000`;
- shutdown closes the pool without leaving persistent idle connections.
