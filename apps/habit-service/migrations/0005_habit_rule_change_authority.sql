BEGIN;

CREATE TABLE habit.habit_definition_revisions (
  revision_sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL,
  habit_id uuid NOT NULL,
  revision_number integer NOT NULL,
  effective_from_local_date date NOT NULL,
  effective_from timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  idempotency_key uuid NOT NULL,
  title text NOT NULL,
  timezone_name text NOT NULL,
  recurrence_kind text NOT NULL,
  recurrence_interval smallint NOT NULL,
  weekday_mask smallint NOT NULL,
  CONSTRAINT habit_definition_revisions_habit_workspace_foreign
    FOREIGN KEY (habit_id, workspace_id)
    REFERENCES habit.habit_definitions (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT habit_definition_revisions_revision_number_valid
    CHECK (revision_number >= 2),
  CONSTRAINT habit_definition_revisions_workspace_uuid_v4 CHECK (
    workspace_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT habit_definition_revisions_habit_uuid_v4 CHECK (
    habit_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT habit_definition_revisions_idempotency_uuid_v4 CHECK (
    idempotency_key::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT habit_definition_revisions_title_nonblank
    CHECK (length(btrim(title)) > 0),
  CONSTRAINT habit_definition_revisions_timezone_nonblank
    CHECK (length(btrim(timezone_name)) > 0),
  CONSTRAINT habit_definition_revisions_recurrence_kind_valid
    CHECK (recurrence_kind IN ('daily', 'weekly')),
  CONSTRAINT habit_definition_revisions_recurrence_interval_valid
    CHECK (recurrence_interval BETWEEN 1 AND 365),
  CONSTRAINT habit_definition_revisions_weekday_mask_valid CHECK (
    (recurrence_kind = 'daily' AND weekday_mask = 0)
    OR
    (recurrence_kind = 'weekly' AND weekday_mask BETWEEN 1 AND 127)
  ),
  CONSTRAINT habit_definition_revisions_revision_unique
    UNIQUE (workspace_id, habit_id, revision_number),
  CONSTRAINT habit_definition_revisions_boundary_unique
    UNIQUE (workspace_id, habit_id, effective_from_local_date),
  CONSTRAINT habit_definition_revisions_idempotency_unique
    UNIQUE (workspace_id, habit_id, idempotency_key)
);

CREATE INDEX habit_definition_revisions_effective_idx
  ON habit.habit_definition_revisions (
    workspace_id,
    habit_id,
    effective_from_local_date ASC,
    revision_number ASC
  );

CREATE FUNCTION habit.reject_definition_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Habit definition revision history is append-only';
END;
$$;

CREATE TRIGGER habit_definition_revisions_append_only
BEFORE UPDATE OR DELETE ON habit.habit_definition_revisions
FOR EACH ROW
EXECUTE FUNCTION habit.reject_definition_revision_mutation();

CREATE TRIGGER habit_definition_revisions_reject_truncate
BEFORE TRUNCATE ON habit.habit_definition_revisions
FOR EACH STATEMENT
EXECUTE FUNCTION habit.reject_definition_revision_mutation();

CREATE FUNCTION habit.revise_habit_definition(
  target_workspace_id uuid,
  target_habit_id uuid,
  target_effective_from_local_date date,
  target_title text,
  target_timezone_name text,
  target_recurrence_kind text,
  target_recurrence_interval smallint,
  target_weekday_mask smallint,
  target_idempotency_key uuid,
  target_recorded_at timestamptz
)
RETURNS TABLE (
  workspace_id uuid,
  habit_id uuid,
  revision_number integer,
  effective_from_local_date date,
  recorded_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, habit
AS $$
DECLARE
  base_definition habit.habit_definitions%ROWTYPE;
  replay habit.habit_definition_revisions%ROWTYPE;
  previous_revision habit.habit_definition_revisions%ROWTYPE;
  current_revision habit.habit_definition_revisions%ROWTYPE;
  current_timezone text;
  previous_timezone text;
  current_local_date date;
  latest_effective_date date;
  next_revision_number integer;
  target_effective_from timestamptz;
BEGIN
  SELECT *
  INTO base_definition
  FROM habit.habit_definitions
  WHERE habit_definitions.workspace_id = target_workspace_id
    AND habit_definitions.id = target_habit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Habit not found';
  END IF;

  SELECT *
  INTO replay
  FROM habit.habit_definition_revisions
  WHERE habit_definition_revisions.workspace_id = target_workspace_id
    AND habit_definition_revisions.habit_id = target_habit_id
    AND habit_definition_revisions.idempotency_key = target_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF ROW(
         replay.effective_from_local_date,
         replay.title,
         replay.timezone_name,
         replay.recurrence_kind,
         replay.recurrence_interval,
         replay.weekday_mask
       ) IS DISTINCT FROM ROW(
         target_effective_from_local_date,
         target_title,
         target_timezone_name,
         target_recurrence_kind,
         target_recurrence_interval,
         target_weekday_mask
       )
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Habit definition revision idempotency conflict';
    END IF;

    RETURN QUERY
    SELECT replay.workspace_id,
           replay.habit_id,
           replay.revision_number,
           replay.effective_from_local_date,
           replay.recorded_at;
    RETURN;
  END IF;

  SELECT *
  INTO current_revision
  FROM habit.habit_definition_revisions
  WHERE habit_definition_revisions.workspace_id = target_workspace_id
    AND habit_definition_revisions.habit_id = target_habit_id
    AND habit_definition_revisions.effective_from <= target_recorded_at
  ORDER BY effective_from DESC, revision_number DESC
  LIMIT 1;

  current_timezone := COALESCE(
    current_revision.timezone_name,
    base_definition.timezone_name
  );
  current_local_date :=
    (target_recorded_at AT TIME ZONE current_timezone)::date;

  IF target_effective_from_local_date < current_local_date THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Habit definition revision cannot be backdated';
  END IF;

  SELECT max(habit_definition_revisions.effective_from_local_date)
  INTO latest_effective_date
  FROM habit.habit_definition_revisions
  WHERE habit_definition_revisions.workspace_id = target_workspace_id
    AND habit_definition_revisions.habit_id = target_habit_id;

  IF latest_effective_date IS NOT NULL
     AND target_effective_from_local_date <= latest_effective_date
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Habit definition revision effective boundary already claimed';
  END IF;

  SELECT *
  INTO previous_revision
  FROM habit.habit_definition_revisions
  WHERE habit_definition_revisions.workspace_id = target_workspace_id
    AND habit_definition_revisions.habit_id = target_habit_id
  ORDER BY effective_from_local_date DESC, revision_number DESC
  LIMIT 1;

  previous_timezone := COALESCE(
    previous_revision.timezone_name,
    base_definition.timezone_name
  );
  target_effective_from :=
    target_effective_from_local_date::timestamp AT TIME ZONE previous_timezone;

  next_revision_number := COALESCE(
    previous_revision.revision_number,
    1
  ) + 1;

  INSERT INTO habit.habit_definition_revisions (
    workspace_id,
    habit_id,
    revision_number,
    effective_from_local_date,
    effective_from,
    recorded_at,
    idempotency_key,
    title,
    timezone_name,
    recurrence_kind,
    recurrence_interval,
    weekday_mask
  )
  VALUES (
    target_workspace_id,
    target_habit_id,
    next_revision_number,
    target_effective_from_local_date,
    target_effective_from,
    target_recorded_at,
    target_idempotency_key,
    target_title,
    target_timezone_name,
    target_recurrence_kind,
    target_recurrence_interval,
    target_weekday_mask
  )
  RETURNING * INTO replay;

  RETURN QUERY
  SELECT replay.workspace_id,
         replay.habit_id,
         replay.revision_number,
         replay.effective_from_local_date,
         replay.recorded_at;
END;
$$;

REVOKE ALL ON FUNCTION habit.revise_habit_definition(
  uuid, uuid, date, text, text, text, smallint, smallint, uuid, timestamptz
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION habit.erase_workspace_data(target_workspace_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, habit
AS $$
DECLARE
  deleted_completion_events integer := 0;
  deleted_definition_revisions integer := 0;
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

  ALTER TABLE habit.habit_definition_revisions
    DISABLE TRIGGER habit_definition_revisions_append_only;
  DELETE FROM habit.habit_definition_revisions
  WHERE workspace_id = target_workspace_id;
  GET DIAGNOSTICS deleted_definition_revisions = ROW_COUNT;
  ALTER TABLE habit.habit_definition_revisions
    ENABLE TRIGGER habit_definition_revisions_append_only;

  DELETE FROM habit.habit_definition_history
  WHERE workspace_id = target_workspace_id;
  GET DIAGNOSTICS deleted_definition_history = ROW_COUNT;

  DELETE FROM habit.habit_definitions
  WHERE workspace_id = target_workspace_id;
  GET DIAGNOSTICS deleted_habit_definitions = ROW_COUNT;

  RETURN deleted_completion_events
    + deleted_definition_revisions
    + deleted_definition_history
    + deleted_habit_definitions;
END;
$$;

REVOKE ALL ON FUNCTION habit.erase_workspace_data(uuid) FROM PUBLIC;

COMMENT ON TABLE habit.habit_definition_revisions IS
  'Habit-owned immutable effective-dated definition revisions and idempotency authority.';
COMMENT ON FUNCTION habit.revise_habit_definition(
  uuid, uuid, date, text, text, text, smallint, smallint, uuid, timestamptz
) IS
  'Atomically accepts one normalized effective-dated Habit definition revision under a short row lock.';

COMMIT;
