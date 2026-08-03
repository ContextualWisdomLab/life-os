BEGIN;

ALTER TABLE planning.goals
  ADD CONSTRAINT goals_id_uuid_v4 CHECK (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  ADD CONSTRAINT goals_workspace_id_uuid_v4 CHECK (
    workspace_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

ALTER TABLE planning.projects
  ADD CONSTRAINT projects_id_uuid_v4 CHECK (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  ADD CONSTRAINT projects_workspace_id_uuid_v4 CHECK (
    workspace_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  ADD CONSTRAINT projects_goal_id_uuid_v4 CHECK (
    goal_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

ALTER TABLE planning.tasks
  ADD CONSTRAINT tasks_id_workspace_unique UNIQUE (id, workspace_id),
  ADD CONSTRAINT tasks_id_uuid_v4 CHECK (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  ADD CONSTRAINT tasks_workspace_id_uuid_v4 CHECK (
    workspace_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  ADD CONSTRAINT tasks_project_id_uuid_v4 CHECK (
    project_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

DROP INDEX IF EXISTS planning.goals_workspace_created_idx;
DROP INDEX IF EXISTS planning.projects_workspace_goal_idx;
DROP INDEX IF EXISTS planning.tasks_workspace_project_idx;

CREATE INDEX goals_workspace_creation_idx
  ON planning.goals (workspace_id, created_at ASC, id ASC);

CREATE INDEX projects_workspace_goal_creation_idx
  ON planning.projects (workspace_id, goal_id, created_at ASC, id ASC);

CREATE INDEX tasks_workspace_project_creation_idx
  ON planning.tasks (workspace_id, project_id, created_at ASC, id ASC);

COMMIT;
