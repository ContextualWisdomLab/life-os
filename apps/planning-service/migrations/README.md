# Planning migrations

Apply SQL files in lexical order to the PostgreSQL database owned by the Planning service.

The initial migration enforces tenant boundaries structurally: project-to-goal and task-to-project foreign keys include `workspace_id`, preventing a child record from referencing a parent in another workspace.
