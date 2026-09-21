# Notification persistence operations

## Purpose

The notification service owns the `notification_service` PostgreSQL schema. The schema persists reminder occurrences, expiring worker claims, immutable scheduler outcomes, credential-free in-app inbox messages, and the bounded authority/receipt evidence needed to execute Notification-owned data-rights erasure. It is an independent bounded context and must not read or mutate another service's tables.

This design provides at-least-once scheduler execution with atomic claims and idempotent delivery evidence. It does not claim distributed exactly-once execution. Safe replay depends on the repository transition checks and the in-app gateway's persisted SHA-256 idempotency digest.

## Migration

Apply the Notification migrations in numeric order through `infra/kubernetes/run-migrations.sh`. `0001_durable_reminder_inbox.sql` establishes the schema and its original object owner. `0002_data_rights_erasure.sql` adds the terminal workspace-erasure fence, transaction-local delete authorization, replay receipts, and owner-controlled erasure procedure. `0003_data_rights_authority_replay.sql` adds the bounded runtime replay store used by the authenticated internal data-rights boundary.

The connection behind `NOTIFICATION_MIGRATION_DATABASE_URL` is the stable migration authority. It must remain the owner of the existing `notification_service` schema, legacy reminder tables, and mutation-guard function when later migrations run. The migration runner verifies that ownership before applying migration 0002 or later and fails closed with `notification_migration_owner_mismatch` rather than attempting an implicit ownership transfer. If an operator intentionally rotates the migration owner, perform a separately authorized database-administration ownership handoff first, verify the resulting owners, then rerun the forward migration. Do not grant the application runtime ownership merely to make a migration pass.

The runtime identity named by `NOTIFICATION_DATABASE_RUNTIME_ROLE` must be distinct from the migration authority. After migration, the runner removes broad privileges and grants only the Notification runtime permissions needed by the repository and data-rights adapter. The owner-only erasure tables remain inaccessible to the runtime except for the narrowly required authority-replay table operations and the explicit `erase_workspace_data` function execution path.

### Existing local Compose volumes

Local PostgreSQL volumes created by earlier LifeOS `main` revisions were initialized with the development administrator credential `lifeos`/`lifeos`. PostgreSQL stores that role password inside the initialized volume; changing `POSTGRES_PASSWORD` later does not rotate it. For that reason, `compose.yaml` keeps `${POSTGRES_PASSWORD:-lifeos}` only as an upgrade-compatible local administrator fallback. Do not delete an existing development volume merely to introduce the Notification runtime role.

For an existing volume, leave `POSTGRES_PASSWORD` unset when the stored administrator password is still `lifeos`, or supply the actual administrator password already stored by that volume. Keep `NOTIFICATION_RUNTIME_DATABASE_PASSWORD` explicit and fresh: the Notification provisioner uses it only for the distinct least-privilege runtime role. Start PostgreSQL, run the idempotent one-shot provisioner, then start the remaining services:

```bash
docker compose up -d postgres
docker compose run --rm --no-deps notification-db-provision
docker compose up -d
```

Fresh local installations should copy `.env.example` and replace its placeholder credentials before startup. Production and shared deployments must not rely on the local `lifeos` compatibility fallback; supply administrator or migration authority through the deployment's managed-secret boundary and keep runtime credentials separate.

Before rollout, verify that the target database is PostgreSQL 16 or a compatibility-tested later release and that the connection uses TLS outside a private development environment.

## Runtime configuration

The service validates all runtime configuration before allocating a pool. Migration credentials are consumed only by the forward-migration job and are not passed to the Notification process.

| Variable                                   | Default | Accepted boundary                                      |
| ------------------------------------------ | ------: | ------------------------------------------------------ |
| `NOTIFICATION_MIGRATION_DATABASE_URL`      |    none | migration-only `postgres:` or `postgresql:` URL        |
| `NOTIFICATION_DATABASE_RUNTIME_ROLE`       |    none | existing least-privilege PostgreSQL role name          |
| `NOTIFICATION_DATABASE_URL`                |    none | runtime-only `postgres:` or `postgresql:` URL          |
| `NOTIFICATION_DATA_RIGHTS_CONTEXT_SECRET`  |    none | distinct secret used only for signed internal context  |
| `NOTIFICATION_DATABASE_POOL_MAX`           |    `10` | integer `1`–`32`                                       |
| `NOTIFICATION_DATABASE_CONNECT_TIMEOUT_MS` |  `5000` | integer `100`–`30000`                                  |
| `NOTIFICATION_DATABASE_IDLE_TIMEOUT_MS`    | `30000` | integer `1000`–`300000`                                |
| `NOTIFICATION_CLAIM_LEASE_SECONDS`         |   `300` | integer `30`–`3600`                                    |
| `NOTIFICATION_REMINDER_BATCH_SIZE`         |    `50` | integer `1`–`100`                                      |

The runtime pool sets `application_name` to `life-os-notification-service`. Use this value to distinguish service connections in PostgreSQL activity and connection metrics.

## Data-rights boundary

`POST /v1/internal/data-rights/contributor` is a private Notification-owned endpoint. It accepts only a valid signed `life-os.data-rights-context.v1` envelope whose method, path, workspace, requesting user, and issuance time match the request. The service never accepts browser cookies, bearer tokens, or a client-selected workspace as data-rights authority.

The contributor supports `export`, `erase_preflight`, `erase`, and `verify_erased`. Export uses deterministic cross-table keyset pagination and returns an opaque continuation cursor when another page exists. Claim digests and raw idempotency material are deliberately excluded from portable output. A cursor is ordering evidence, not a durable snapshot token: callers must not claim transactionally frozen multi-page export semantics until a versioned snapshot/export-session contract is implemented and tested.

Erasure is serialized per workspace with an exclusive transaction-scoped advisory lock. The owner-controlled procedure persists a terminal workspace fence before deleting Notification-owned records, creates transaction-local authorization for append-only outcome deletion, removes that authorization before the transaction completes, and writes a replay-safe SHA-256 receipt. Ordinary runtime writes take the corresponding shared workspace lock and reject a persisted erasure fence, so a write that races erasure cannot survive after the erasure commits.

The runtime replay store validates reuse of `(workspace_id, request_id, requested_by_user_id)` only for the exact same payload digest and bounded TTL. Conflicting authority or payload reuse fails closed. The signing secret and replay semantics are service-owned control-plane state and are not portable user data.

## Claim and recovery model

Due-row selection is advisory. The authoritative ownership boundary is one tenant-scoped conditional update that writes a SHA-256 digest of a unique per-attempt claim token and a bounded expiration time.

A worker may process an occurrence only when its claim update returns a unique opaque claim token. Concurrent workers can observe the same due row, but only one unexpired claim succeeds.

If a worker exits after claiming but before a terminal transition, another worker can claim the occurrence after `claim_expires_at`. Operators should not clear active claims manually during normal operation. For urgent recovery, first confirm that the original worker is no longer running and that no delivery provider request remains in flight. Prefer waiting for the bounded lease to expire.

Repository failures are isolated per occurrence. A delivered-count read or transition failure increments the scheduler's `persistenceFailures` aggregate and processing continues with the remaining bounded batch. Alert on any non-zero value and investigate PostgreSQL health; do not classify it as a provider delivery failure or manually release the active claim.

Runtime shutdown shares one in-flight close operation across concurrent callers. If pool closure rejects, the runtime preserves the error and permits a later shutdown attempt instead of reporting a false closed state.

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

Do not log `reminder_title`, raw idempotency keys, database URLs, signing material, or provider credentials while investigating claims or data-rights requests.

## Delivery replay

The in-app gateway stores only a 32-byte SHA-256 digest of the composite idempotency key. A repeated insert is accepted only when the persisted workspace, reminder, title, due instant, and time zone match the attempted message.

Claim tokens are separate from stable delivery idempotency keys, and every transition requires both the exact token digest and an unexpired lease. A mismatched replay raises `NotificationReplayConflictError` and must be treated as an integrity incident. Do not delete the existing inbox row to force the retry through. Preserve the row and the corresponding occurrence for investigation.

A provider success followed by a repository failure can therefore be retried safely: the inbox insert resolves as an exact replay, and the repository can complete the terminal occurrence transition after reacquiring an expired lease.

## Outcome integrity

Every delivered, deferred, retryable-failed, or terminal-failed transition is written in the same PostgreSQL statement as the corresponding occurrence mutation. The statement fails closed unless the worker owns the exact claim digest and the occurrence still has the expected due instant and attempt count.

Outcome history is append-only for ordinary callers. Direct update, delete, and truncate operations are rejected. The only destructive exception is the reviewed owner-controlled data-rights erasure procedure, whose transaction-local authorization is scoped to one backend, transaction, and workspace. Administrative corrections outside that data-rights contract must be represented as a new, separately reviewed migration or compensating evidence record; never disable the mutation guard in place.

## Privacy and security boundaries

The persistence layer stores reminder titles and scheduling metadata because they are required to render the in-app inbox. It does not store cookies, bearer tokens, provider authorization values, arbitrary callback URLs, raw idempotency keys, or exception text.

Operational controls should include:

- encrypted database transport and encrypted storage;
- a stable migration owner separated from the least-privilege runtime role;
- tenant-scoped repository methods with fixed parameterized SQL;
- database backups and restore tests that include the `notification_service` schema;
- restricted access to inbox content and query logs;
- purpose-bound access and audited data-rights execution;
- retention and deletion policy approval before exposing user-facing history controls.

Database statement logging can capture bound reminder titles depending on PostgreSQL and proxy configuration. Keep production statement logging at a privacy-reviewed level and prohibit query logging in application error payloads.

## Rollback boundary

Application rollback is safe only while the prior version can ignore the new schema. Do not roll back the schema destructively while any runtime may still use it.

The forward migrations have no automatic down migration because reminder outcomes, inbox messages, erasure fences, and receipts are durable user/control evidence. A rollback should:

1. stop new notification scheduling, delivery, and data-rights execution;
2. drain or terminate notification workers;
3. deploy the prior application version only if it safely ignores the newer schema;
4. retain the `notification_service` schema, erasure fences, and receipts intact;
5. verify no prior process attempts incompatible writes;
6. prepare a separately reviewed forward repair migration.

Dropping the schema is destructive and is permitted only in disposable development or test databases. Production removal requires an approved retention/export plan, verified backups, and an explicit maintenance change.

## Verification after deployment

Verify all of the following on the deployed release:

- migrations completed once without partial objects and the configured migration login still owns the established Notification objects;
- the runtime role is distinct from the migration owner and has no owner-only erasure-table privileges;
- the application pool is bounded and identified by `application_name`;
- the private data-rights endpoint rejects unsigned, stale, replayed, and mismatched authority before contributor execution;
- a bounded export page returns deterministic evidence and an opaque cursor only when another page exists;
- erasure preflight reports missing runtime privileges without exposing database details;
- an erase/replay/verify lifecycle removes exactly one workspace and preserves another tenant;
- same-workspace writes cannot survive a committed erasure fence;
- one due occurrence produces one successful claim;
- an expired test claim can be recovered;
- one exact delivery replay produces one inbox message;
- tenant-scoped reads never return another workspace's records;
- ordinary outcome mutation attempts fail with SQLSTATE `55000`;
- shutdown closes the pool without leaving persistent idle connections.
