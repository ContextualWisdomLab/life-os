# Habit migrations

Apply Habit SQL files in lexical order to the PostgreSQL database owned by the Habit service before starting the corresponding application version.

- `0001_recurring_habit_core.sql` creates tenant-safe habit definitions and append-only completion events. Weekly recurrence days are stored as a seven-bit ISO-weekday mask, while the service domain exposes normalized weekday numbers from Monday (`1`) through Sunday (`7`).

## Integrity guarantees

Every persisted entity, workspace, habit reference, event, and idempotency key is constrained to UUIDv4. Composite foreign keys carry `workspace_id` through the ownership path, and duplicate completion commands are identified by `(workspace_id, habit_id, idempotency_key)`.

Database triggers reject `UPDATE`, `DELETE`, and `TRUNCATE` operations on completion events. The service runtime role must not receive `UPDATE`, `DELETE`, or `TRUNCATE` privileges on `habit.completion_events`. A future data-rights migration must provide a separately authorized erasure path before production account deletion is enabled; application code must not bypass append-only history through direct SQL.

## Repository behavior

`PostgresHabitRepository` binds every SQL value, scopes every lookup by `workspace_id`, validates stored UUIDv4 identifiers, recurrence masks, IANA timezones, local dates, timestamps, tenant ownership, and result cardinality, and returns deterministic reads aligned with the migration indexes.

A duplicate completion command is recovered only when PostgreSQL reports the named idempotency constraint. The persisted scheduled date and completion timestamp must match the replay payload; conflicting reuse is rejected. Other driver or transport failures are converted to a credential-free `HabitPersistenceError` rather than exposing connection details.

## Runtime configuration

The production NestJS module requires `HABIT_DATABASE_URL` using the `postgres:` or `postgresql:` scheme. Optional bounded settings are `HABIT_DATABASE_POOL_MAX` (`1`–`32`, default `10`), `HABIT_DATABASE_CONNECT_TIMEOUT_MS` (`100`–`30000`, default `5000`), and `HABIT_DATABASE_IDLE_TIMEOUT_MS` (`1000`–`300000`, default `30000`). The pool identifies itself as `life-os-habit-service` and is closed exactly once through NestJS shutdown hooks.

The versioned API accepts tenant ownership only from `x-workspace-id` and exposes habit creation/listing, occurrence generation, idempotent completion commands, and completion history below `/v1`. Validation and persistence failures return bounded problem details without SQL, connection strings, or credentials.

CI applies the migration to the disposable PostgreSQL service through `HABIT_DATABASE_URL` and exercises restart durability, tenant isolation, concurrent duplicate serialization, HTTP lifecycle behavior, conflicting replay rejection, stable ordering, and append-only `UPDATE`, `DELETE`, and `TRUNCATE` enforcement.

## Rollback

This migration is forward-only in automated environments. An operator-approved rollback must first export tenant data, then drop `habit.completion_events`, `habit.habit_definitions`, `habit.reject_completion_mutation()`, and the `habit` schema. Do not roll back after serving completion writes unless the exported history has been verified and the data-retention decision is documented.
