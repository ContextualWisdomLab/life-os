CREATE TABLE planning.task_completion_facts (
  completion_fact_id uuid PRIMARY KEY,
  completion_sequence bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  workspace_id uuid NOT NULL,
  task_id uuid NOT NULL,
  completed_at timestamptz NOT NULL,
  CONSTRAINT task_completion_facts_id_uuid_v4 CHECK (
    completion_fact_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT task_completion_facts_sequence_unique UNIQUE (completion_sequence),
  CONSTRAINT task_completion_facts_task_workspace_fk
    FOREIGN KEY (task_id, workspace_id)
    REFERENCES planning.tasks (id, workspace_id)
    ON DELETE CASCADE
);

CREATE INDEX task_completion_facts_workspace_completed_idx
  ON planning.task_completion_facts
  (workspace_id, completed_at, task_id, completion_sequence);
