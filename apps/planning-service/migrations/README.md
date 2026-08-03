# Planning migrations

Apply SQL files in lexical order to the PostgreSQL database owned by the Planning service.

The initial migration enforces tenant boundaries structurally: project-to-goal and task-to-project foreign keys include `workspace_id`, preventing a child record from referencing a parent in another workspace.

The second migration requires UUIDv4 values for every planning and workspace identifier and adds indexes matching stable workspace-scoped creation-order reads. Roll back that migration by dropping the three `*_created_id_idx` indexes and the UUIDv4 check constraints before reverting application code that depends on those guarantees.
