# Habit migrations

Apply Habit SQL files in lexical order to the PostgreSQL database owned by the Habit service before starting the corresponding application version.

- `0001_recurring_habit_core.sql` creates tenant-safe habit definitions and append-only completion events. Weekly recurrence days are stored as a seven-bit ISO-weekday mask, while the service domain exposes normalized weekday numbers from Monday (`1`) through Sunday (`7`).
- `0002_data_rights_erasure.sql` adds the separately authorized, owner-executed workspace erasure path and durable erasure receipts.
- `0003_data_rights_authority_replay.sql` binds erasure authorization replay to the persisted request evidence.
- `0004_habit_definition_history.sql` archives superseded Habit-owned definition snapshots, preserves bounded as-of Review reads after a definition changes, rejects identity/creation-evidence rewrites, and extends owner-authorized erasure to definition history.

## Integrity guarantees

Every persisted entity, workspace, habit reference, event, and idempotency key is constrained to UUIDv4. Composite foreign keys carry `workspace_id` through the ownership path, and duplicate completion commands are identified by `(workspace_id, habit_id, idempotency_key)`.

Completion events remain append-only for ordinary callers. Semantic updates to `habit.habit_definitions` archive the prior definition before the current row changes; no-op updates do not create history. `id`, `workspace_id`, and `created_at` are immutable through that update path. Superseded definition rows remain Habit-owned and are removed by the existing owner-authorized data-rights erasure function rather than by application-side cross-service SQL.

`habit_definition_history_workspace_as_of_idx` supports the Review query's tenant/id/as-of lookup. The repository first bounds current Habit rows by `maximumHabits`, then resolves at most one superseded snapshot for each bounded Habit in the same PostgreSQL statement. Application code therefore does not issue per-Habit history queries.

## Repository behavior

`PostgresHabitRepository` binds every SQL value, scopes every lookup by `workspace_id`, validates stored UUIDv4 identifiers, recurrence masks, IANA timezones, local dates, timestamps, tenant ownership, and result cardinality, and returns deterministic reads aligned with the migration indexes.

Weekly Review evidence is an as-of read. If a definition was superseded after the requested `asOf`, the repository selects the earliest superseded snapshot after that instant; otherwise it uses the current definition. This preserves the denominator that was in force at the requested evidence instant while allowing ordinary current reads to observe the revised definition. Explicit effective-dated buyer mutation semantics are a separate domain contract and are not inferred from this storage-level history mechanism.

A duplicate completion command is recovered only when PostgreSQL reports the named idempotency constraint. The persisted scheduled date and completion timestamp must match the replay payload; conflicting reuse is rejected. Other driver or transport failures are converted to a credential-free `HabitPersistenceError` rather than exposing connection details.

## Runtime configuration

The production NestJS module requires `HABIT_DATABASE_URL` using the `postgres:` or `postgresql:` scheme. Optional bounded settings are `HABIT_DATABASE_POOL_MAX` (`1`–`32`, default `10`), `HABIT_DATABASE_CONNECT_TIMEOUT_MS` (`100`–`30000`, default `5000`), and `HABIT_DATABASE_IDLE_TIMEOUT_MS` (`1000`–`300000`, default `30000`). The pool identifies itself as `life-os-habit-service` and is closed exactly once through NestJS shutdown hooks.

The versioned API accepts tenant ownership only from `x-workspace-id` and exposes habit creation/listing, occurrence generation, idempotent completion commands, and completion history below `/v1`. Validation and persistence failures return bounded problem details without SQL, connection strings, or credentials.

CI applies all migrations to a disposable PostgreSQL service and exercises restart durability, tenant isolation, concurrent duplicate serialization, HTTP lifecycle behavior, conflicting replay rejection, stable ordering, append-only completion enforcement, historical definition selection, current-definition visibility, immutable definition identity evidence, and data-rights erasure of superseded definitions.

## Rollback

These migrations are forward-only in automated environments. An operator-approved rollback must first export tenant data and verify the retention decision. After `0004`, rollback must preserve or explicitly dispose of `habit.habit_definition_history` before dropping its trigger/function and the underlying Habit tables. Do not roll back after serving completion or definition-change writes unless exported evidence has been verified and the recovery decision is documented.
