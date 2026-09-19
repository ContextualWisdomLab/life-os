BEGIN;

CREATE TABLE habit.habit_definition_history (
  history_sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  title text NOT NULL,
  timezone_name text NOT NULL,
  recurrence_kind text NOT NULL,
  recurrence_interval smallint NOT NULL,
  weekday_mask smallint NOT NULL,
  starts_on date NOT NULL,
  created_at timestamptz NOT NULL,
  superseded_at timestamptz NOT NULL,
  CONSTRAINT habit_definition_history_habit_workspace_foreign
    FOREIGN KEY (id, workspace_id)
    REFERENCES habit.habit_definitions (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT habit_definition_history_id_uuid_v4 CHECK (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT habit_definition_history_workspace_id_uuid_v4 CHECK (
    workspace_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT habit_definition_history_title_nonblank CHECK (
    length(btrim(title)) > 0
  ),
  CONSTRAINT habit_definition_history_timezone_nonblank CHECK (
    length(btrim(timezone_name)) > 0
  ),
  CONSTRAINT habit_definition_history_recurrence_kind_valid CHECK (
    recurrence_kind IN ('daily', 'weekly')
  ),
  CONSTRAINT habit_definition_history_recurrence_interval_valid CHECK (
    recurrence_interval BETWEEN 1 AND 365
  ),
  CONSTRAINT habit_definition_history_weekday_mask_valid CHECK (
    (recurrence_kind = 'daily' AND weekday_mask = 0)
    OR
    (recurrence_kind = 'weekly' AND weekday_mask BETWEEN 1 AND 127)
  )
);

CREATE INDEX habit_definition_history_workspace_as_of_idx
  ON habit.habit_definition_history (
    workspace_id,
    id,
    superseded_at ASC,
    history_sequence ASC
  );

CREATE FUNCTION habit.capture_habit_definition_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, habit
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Habit definition identity and creation evidence are immutable';
  END IF;

  IF ROW(
       NEW.title,
       NEW.timezone_name,
       NEW.recurrence_kind,
       NEW.recurrence_interval,
       NEW.weekday_mask,
       NEW.starts_on
     ) IS NOT DISTINCT FROM ROW(
       OLD.title,
       OLD.timezone_name,
       OLD.recurrence_kind,
       OLD.recurrence_interval,
       OLD.weekday_mask,
       OLD.starts_on
     )
  THEN
    RETURN NEW;
  END IF;

  INSERT INTO habit.habit_definition_history (
    id,
    workspace_id,
    title,
    timezone_name,
    recurrence_kind,
    recurrence_interval,
    weekday_mask,
    starts_on,
    created_at,
    superseded_at
  )
  VALUES (
    OLD.id,
    OLD.workspace_id,
    OLD.title,
    OLD.timezone_name,
    OLD.recurrence_kind,
    OLD.recurrence_interval,
    OLD.weekday_mask,
    OLD.starts_on,
    OLD.created_at,
    clock_timestamp()
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION habit.capture_habit_definition_history() FROM PUBLIC;

CREATE TRIGGER habit_definitions_capture_history
BEFORE UPDATE ON habit.habit_definitions
FOR EACH ROW
EXECUTE FUNCTION habit.capture_habit_definition_history();

CREATE OR REPLACE FUNCTION habit.erase_workspace_data(target_workspace_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, habit
AS $$
DECLARE
  deleted_completion_events integer := 0;
  deleted_definition_history integer := 0;
  deleted_habit_definitions integer := 0;
BEGIN
  IF target_workspace_id IS NULL OR target_workspace_id::text !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Habit erasure workspace identifier is invalid';
  END IF;

  ALTER TABLE habit.completion_events
    DISABLE TRIGGER completion_events_append_only;

  DELETE FROM habit.completion_events
  WHERE workspace_id = target_workspace_id;
  GET DIAGNOSTICS deleted_completion_events = ROW_COUNT;

  ALTER TABLE habit.completion_events
    ENABLE TRIGGER completion_events_append_only;

  DELETE FROM habit.habit_definition_history
  WHERE workspace_id = target_workspace_id;
  GET DIAGNOSTICS deleted_definition_history = ROW_COUNT;

  DELETE FROM habit.habit_definitions
  WHERE workspace_id = target_workspace_id;
  GET DIAGNOSTICS deleted_habit_definitions = ROW_COUNT;

  RETURN deleted_completion_events
    + deleted_definition_history
    + deleted_habit_definitions;
END;
$$;

REVOKE ALL ON FUNCTION habit.erase_workspace_data(uuid) FROM PUBLIC;

COMMENT ON TABLE habit.habit_definition_history IS
  'Habit-owned superseded definition snapshots used for bounded as-of Review evidence.';

COMMENT ON FUNCTION habit.capture_habit_definition_history() IS
  'Archives the prior durable Habit definition before a semantic definition update.';

COMMENT ON FUNCTION habit.erase_workspace_data(uuid) IS
  'Owner-authorized Habit data-rights erasure, including superseded definition history.';

COMMIT;
