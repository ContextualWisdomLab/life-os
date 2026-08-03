# Planning migrations

Apply SQL files in lexical order to the PostgreSQL database owned by the Planning service.

- `0001_initial_planning.sql` creates tenant-safe Goal → Project → Task tables. Parent-child foreign keys include `workspace_id`, preventing a child record from referencing a parent in another workspace.
- `0002_durable_repository_contract.sql` enforces UUIDv4 identifiers, adds the composite task ownership key used by durable adapters, and replaces descending indexes with deterministic creation-order indexes.

## Rollback

Migrations are forward-only in automated environments. For an operator-approved rollback of `0002`, drop the three `*_creation_idx` indexes, recreate the indexes from `0001`, drop `tasks_id_workspace_unique`, and drop the `*_uuid_v4` check constraints. Roll back `0001` only after exporting service-owned data because it removes the Planning schema.
