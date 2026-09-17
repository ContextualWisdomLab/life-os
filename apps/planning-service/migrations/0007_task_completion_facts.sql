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

CREATE FUNCTION planning.enforce_task_completion_fact_source_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owning_task_status text;
  owning_task_completed_at timestamptz;
  matching_fact_count bigint;
BEGIN
  SELECT status, completed_at
    INTO owning_task_status, owning_task_completed_at
    FROM planning.tasks
   WHERE id = NEW.task_id
     AND workspace_id = NEW.workspace_id;

  SELECT count(*)
    INTO matching_fact_count
    FROM planning.task_completion_facts
   WHERE workspace_id = NEW.workspace_id
     AND task_id = NEW.task_id
     AND completed_at = NEW.completed_at;

  IF owning_task_status IS DISTINCT FROM 'done'
     OR owning_task_completed_at IS DISTINCT FROM NEW.completed_at
     OR matching_fact_count <> 1 THEN
    RAISE EXCEPTION 'Task completion fact has no unique durable source transition'
      USING ERRCODE = '23514',
            CONSTRAINT = 'task_completion_facts_source_transition_check';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION planning.enforce_task_completion_fact_source_transition() IS
  'At transaction acceptance, requires each new fact to be the unique fact matching the owning task current durable done transition.';

CREATE CONSTRAINT TRIGGER task_completion_facts_source_transition_guard
AFTER INSERT
ON planning.task_completion_facts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION planning.enforce_task_completion_fact_source_transition();

CREATE FUNCTION planning.reject_task_completion_fact_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Task completion facts are immutable'
    USING ERRCODE = '23514',
          CONSTRAINT = 'task_completion_facts_immutable';
END;
$$;

COMMENT ON FUNCTION planning.reject_task_completion_fact_update() IS
  'Rejects UPDATE so durable Planning completion facts remain append-only while DELETE remains available for erasure and cascade.';

CREATE TRIGGER task_completion_facts_immutability_guard
BEFORE UPDATE
ON planning.task_completion_facts
FOR EACH ROW
EXECUTE FUNCTION planning.reject_task_completion_fact_update();

CREATE FUNCTION planning.reject_task_completion_fact_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Task completion facts cannot be truncated'
    USING ERRCODE = '23514',
          CONSTRAINT = 'task_completion_facts_truncate_forbidden';
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION planning.reject_task_completion_fact_truncate() IS
  'Rejects table-wide TRUNCATE so accepted completion evidence can only be removed through explicit task/data-rights DELETE semantics.';

CREATE TRIGGER task_completion_facts_truncate_guard
BEFORE TRUNCATE
ON planning.task_completion_facts
FOR EACH STATEMENT
EXECUTE FUNCTION planning.reject_task_completion_fact_truncate();

CREATE INDEX task_completion_facts_workspace_completed_idx
  ON planning.task_completion_facts
  (workspace_id, completed_at, task_id, completion_sequence);
