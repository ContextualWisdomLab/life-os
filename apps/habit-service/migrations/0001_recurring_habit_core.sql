BEGIN;

CREATE SCHEMA IF NOT EXISTS habit;

CREATE TABLE habit.habit_definitions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  title text NOT NULL,
  timezone_name text NOT NULL,
  recurrence_kind text NOT NULL,
  recurrence_interval smallint NOT NULL,
  weekday_mask smallint NOT NULL DEFAULT 0,
  starts_on date NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT habit_definitions_id_workspace_unique
    UNIQUE (id, workspace_id),
  CONSTRAINT habit_definitions_id_uuid_v4 CHECK (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT habit_definitions_workspace_id_uuid_v4 CHECK (
    workspace_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT habit_definitions_title_nonblank CHECK (
    length(btrim(title)) > 0
  ),
  CONSTRAINT habit_definitions_timezone_nonblank CHECK (
    length(btrim(timezone_name)) > 0
  ),
  CONSTRAINT habit_definitions_recurrence_kind_valid CHECK (
    recurrence_kind IN ('daily', 'weekly')
  ),
  CONSTRAINT habit_definitions_recurrence_interval_valid CHECK (
    recurrence_interval BETWEEN 1 AND 365
  ),
  CONSTRAINT habit_definitions_weekday_mask_valid CHECK (
    (recurrence_kind = 'daily' AND weekday_mask = 0)
    OR
    (recurrence_kind = 'weekly' AND weekday_mask BETWEEN 1 AND 127)
  )
);

CREATE TABLE habit.completion_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  habit_id uuid NOT NULL,
  scheduled_local_date date NOT NULL,
  completed_at timestamptz NOT NULL,
  idempotency_key uuid NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT completion_events_id_workspace_unique
    UNIQUE (id, workspace_id),
  CONSTRAINT completion_events_idempotency_unique
    UNIQUE (workspace_id, habit_id, idempotency_key),
  CONSTRAINT completion_events_habit_workspace_foreign
    FOREIGN KEY (habit_id, workspace_id)
    REFERENCES habit.habit_definitions (id, workspace_id),
  CONSTRAINT completion_events_id_uuid_v4 CHECK (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT completion_events_workspace_id_uuid_v4 CHECK (
    workspace_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT completion_events_habit_id_uuid_v4 CHECK (
    habit_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT completion_events_idempotency_key_uuid_v4 CHECK (
    idempotency_key::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
);

CREATE INDEX habit_definitions_workspace_creation_idx
  ON habit.habit_definitions (workspace_id, created_at ASC, id ASC);

CREATE INDEX completion_events_workspace_habit_schedule_idx
  ON habit.completion_events (
    workspace_id,
    habit_id,
    scheduled_local_date ASC,
    recorded_at ASC,
    id ASC
  );

CREATE INDEX completion_events_workspace_habit_recorded_idx
  ON habit.completion_events (
    workspace_id,
    habit_id,
    recorded_at ASC,
    id ASC
  );

CREATE FUNCTION habit.reject_completion_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Habit completion history is append-only';
END;
$$;

CREATE TRIGGER completion_events_append_only
BEFORE UPDATE OR DELETE ON habit.completion_events
FOR EACH ROW
EXECUTE FUNCTION habit.reject_completion_mutation();

CREATE TRIGGER completion_events_reject_truncate
BEFORE TRUNCATE ON habit.completion_events
FOR EACH STATEMENT
EXECUTE FUNCTION habit.reject_completion_mutation();

COMMIT;
