# Planning migrations

Apply SQL files in lexical order to the PostgreSQL database owned by the Planning service before starting a new application version.

- `0001_initial_planning.sql` creates tenant-safe Goal → Project → Task tables. Parent-child foreign keys include `workspace_id`, preventing a child record from referencing a parent in another workspace.
- `0002_durable_repository_contract.sql` enforces UUIDv4 identifiers, adds the composite task ownership key used by durable adapters, and replaces descending indexes with deterministic creation-order indexes.
- `0003_durable_today_sync.sql` creates the durable Today aggregate and idempotency records used to make Planning-owned Today synchronization replay-safe.
- `0004_data_rights_erasure_receipts.sql` creates durable Planning-owned erasure receipts so data-rights completion can be evidenced without retaining erased subject data.
- `0005_task_completion_chronology.sql` stages the task completion-state invariant with `NOT VALID`. New and changed rows must already satisfy `todo ⇒ completed_at IS NULL` and `done ⇒ completed_at >= created_at`, while PostgreSQL avoids the initial historical-table validation scan during the constraint-add step.
- `0006_validate_task_completion_chronology.sql` validates the staged completion constraint against historical rows in a separate migration boundary. Deployment must fail closed on any historical violation; do not shift application traffic until this migration succeeds.
- `0007_task_completion_facts.sql` creates the Planning-owned completion-fact ledger used to retain each real `todo → done` transition after later retries or reopen. Every fact has an application-generated opaque UUIDv4 primary key; `completion_sequence` is a separate unique ordering key, not domain identity. Facts retain tenant/task ownership and the committed completion instant, cascade with task erasure, and are indexed by workspace + completion time for bounded period projections. The completion repository appends a fact in the same PostgreSQL statement that changes task state; retries while already done do not append duplicates.

Keep `0005` and `0006` as separate lexical migration boundaries. Do not wrap the pair in one transaction: staged addition is intentionally separated from the historical validation scan so the stronger validation lock is not held across unrelated migration work.

## Runtime configuration

The service requires `PLANNING_DATABASE_URL` with a `postgres:` or `postgresql:` scheme. Optional pool settings are `PLANNING_DATABASE_POOL_MAX` (`1`–`32`, default `10`), `PLANNING_DATABASE_CONNECT_TIMEOUT_MS` (`100`–`30000`, default `5000`), and `PLANNING_DATABASE_IDLE_TIMEOUT_MS` (`1000`–`300000`, default `30000`). Credentials belong in the deployment secret store and must never be committed, logged, or returned in HTTP failures.

The application does not apply migrations during startup. Deployment automation must apply every migration exactly once before shifting traffic, then start the service with a database role limited to its owned Planning schema.

## Rollback

Migrations are forward-only in automated environments. Rolling back `0007` destroys historical completion facts, so drop `planning.task_completion_facts` only after an operator-approved export/retention decision and only when loss of Review provenance is acceptable. For an operator-approved rollback of the `0005`/`0006` completion-chronology pair, drop `planning.tasks.tasks_completion_state_check` only after confirming that removing the durable invariant is an acceptable data-integrity regression; `0006` creates no separate database object to undo. For an operator-approved rollback of `0002`, drop the three `*_creation_idx` indexes, recreate the indexes from `0001`, drop `tasks_id_workspace_unique`, and drop the `*_uuid_v4` check constraints. Roll back `0001` only after exporting service-owned data because it removes the Planning schema.
