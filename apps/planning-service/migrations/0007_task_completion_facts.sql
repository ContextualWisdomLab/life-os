CREATE TABLE planning.task_completion_facts (
  completion_sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL,
  task_id uuid NOT NULL,
  completed_at timestamptz NOT NULL,
  CONSTRAINT task_completion_facts_task_workspace_fk
    FOREIGN KEY (task_id, workspace_id)
    REFERENCES planning.tasks (id, workspace_id)
    ON DELETE CASCADE
);

CREATE INDEX task_completion_facts_workspace_completed_idx
  ON planning.task_completion_facts
  (workspace_id, completed_at, task_id, completion_sequence);
