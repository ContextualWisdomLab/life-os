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

CREATE FUNCTION planning.enforce_task_completion_fact_chronology()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owning_task_created_at timestamptz;
BEGIN
  SELECT created_at
    INTO owning_task_created_at
    FROM planning.tasks
   WHERE id = NEW.task_id
     AND workspace_id = NEW.workspace_id;

  IF owning_task_created_at IS NULL OR NEW.completed_at < owning_task_created_at THEN
    RAISE EXCEPTION 'Task completion fact chronology is invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'task_completion_facts_chronology_check';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION planning.enforce_task_completion_fact_chronology() IS
  'Rejects durable completion facts whose completion instant predates the owning Planning task.';

CREATE TRIGGER task_completion_facts_chronology_guard
BEFORE INSERT OR UPDATE OF workspace_id, task_id, completed_at
ON planning.task_completion_facts
FOR EACH ROW
EXECUTE FUNCTION planning.enforce_task_completion_fact_chronology();

CREATE INDEX task_completion_facts_workspace_completed_idx
  ON planning.task_completion_facts
  (workspace_id, completed_at, task_id, completion_sequence);
