CREATE SCHEMA IF NOT EXISTS planning;

CREATE TABLE planning.goals (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goals_id_workspace_unique UNIQUE (id, workspace_id)
);

CREATE TABLE planning.projects (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_id_workspace_unique UNIQUE (id, workspace_id),
  CONSTRAINT projects_goal_workspace_fk
    FOREIGN KEY (goal_id, workspace_id)
    REFERENCES planning.goals (id, workspace_id)
    ON DELETE CASCADE
);

CREATE TABLE planning.tasks (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT tasks_project_workspace_fk
    FOREIGN KEY (project_id, workspace_id)
    REFERENCES planning.projects (id, workspace_id)
    ON DELETE CASCADE
);

CREATE INDEX goals_workspace_created_idx
  ON planning.goals (workspace_id, created_at DESC);

CREATE INDEX projects_workspace_goal_idx
  ON planning.projects (workspace_id, goal_id, created_at DESC);

CREATE INDEX tasks_workspace_project_idx
  ON planning.tasks (workspace_id, project_id, created_at DESC);
