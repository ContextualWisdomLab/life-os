# Planning migrations

Apply SQL files in lexical order to the PostgreSQL database owned by the Planning service before starting a new application version.

- `0001_initial_planning.sql` creates tenant-safe Goal → Project → Task tables. Parent-child foreign keys include `workspace_id`, preventing a child record from referencing a parent in another workspace.
- `0002_durable_repository_contract.sql` enforces UUIDv4 identifiers, adds the composite task ownership key used by durable adapters, and replaces descending indexes with deterministic creation-order indexes.

## Runtime configuration

The service requires `PLANNING_DATABASE_URL` with a `postgres:` or `postgresql:` scheme. Optional pool settings are `PLANNING_DATABASE_POOL_MAX` (`1`–`32`, default `10`), `PLANNING_DATABASE_CONNECT_TIMEOUT_MS` (`100`–`30000`, default `5000`), and `PLANNING_DATABASE_IDLE_TIMEOUT_MS` (`1000`–`300000`, default `30000`). Credentials belong in the deployment secret store and must never be committed, logged, or returned in HTTP failures.

The application does not apply migrations during startup. Deployment automation must apply every migration exactly once before shifting traffic, then start the service with a database role limited to its owned Planning schema.

## Rollback

Migrations are forward-only in automated environments. For an operator-approved rollback of `0002`, drop the three `*_creation_idx` indexes, recreate the indexes from `0001`, drop `tasks_id_workspace_unique`, and drop the `*_uuid_v4` check constraints. Roll back `0001` only after exporting service-owned data because it removes the Planning schema.
