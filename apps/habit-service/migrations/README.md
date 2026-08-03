# Habit migrations

Apply Habit SQL files in lexical order to the PostgreSQL database owned by the Habit service before starting the corresponding application version.

- `0001_recurring_habit_core.sql` creates tenant-safe habit definitions and append-only completion events. Weekly recurrence days are stored as a seven-bit ISO-weekday mask, while the service domain exposes normalized weekday numbers from Monday (`1`) through Sunday (`7`).

## Integrity guarantees

Every persisted entity, workspace, habit reference, event, and idempotency key is constrained to UUIDv4. Composite foreign keys carry `workspace_id` through the ownership path, and duplicate completion commands are identified by `(workspace_id, habit_id, idempotency_key)`.

Database triggers reject `UPDATE`, `DELETE`, and `TRUNCATE` operations on completion events. The service runtime role must not receive `UPDATE`, `DELETE`, or `TRUNCATE` privileges on `habit.completion_events`. A future data-rights migration must provide a separately authorized erasure path before production account deletion is enabled; application code must not bypass append-only history through direct SQL.

## Rollback

This migration is forward-only in automated environments. An operator-approved rollback must first export tenant data, then drop `habit.completion_events`, `habit.habit_definitions`, `habit.reject_completion_mutation()`, and the `habit` schema. Do not roll back after serving completion writes unless the exported history has been verified and the data-retention decision is documented.
