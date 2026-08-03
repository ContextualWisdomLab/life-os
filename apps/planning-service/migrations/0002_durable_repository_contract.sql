BEGIN;

ALTER TABLE planning.tasks
  ADD CONSTRAINT tasks_id_workspace_unique UNIQUE (id, workspace_id);

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
