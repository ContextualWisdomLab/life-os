BEGIN;

CREATE TABLE habit.data_rights_erasure_receipts (
  workspace_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_id uuid NOT NULL,
  requested_by_user_id uuid NOT NULL,
  erased_records integer NOT NULL,
  receipt_sha256 text NOT NULL,
  erased_at timestamptz NOT NULL,
  CONSTRAINT data_rights_erasure_receipts_primary
    PRIMARY KEY (workspace_id, idempotency_key),
  CONSTRAINT data_rights_erasure_receipts_workspace_uuid_v4 CHECK (
    workspace_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT data_rights_erasure_receipts_idempotency_uuid_v4 CHECK (
    idempotency_key::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT data_rights_erasure_receipts_request_uuid_v4 CHECK (
    request_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT data_rights_erasure_receipts_user_uuid_v4 CHECK (
    requested_by_user_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT data_rights_erasure_receipts_count_nonnegative CHECK (
    erased_records >= 0
  ),
  CONSTRAINT data_rights_erasure_receipts_digest_sha256 CHECK (
    receipt_sha256 ~ '^[0-9a-f]{64}$'
  )
);

COMMENT ON TABLE habit.data_rights_erasure_receipts IS
  'Replay evidence for explicitly authorized Habit-owned data-rights erasure.';

CREATE FUNCTION habit.erase_workspace_data(target_workspace_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, habit
AS $$
DECLARE
  deleted_completion_events integer := 0;
  deleted_habit_definitions integer := 0;
BEGIN
  IF target_workspace_id IS NULL OR target_workspace_id::text !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Habit erasure workspace identifier is invalid';
  END IF;

  -- Completion history remains append-only for ordinary callers. This bounded,
  -- owner-executed erasure function is the only reviewed path that temporarily
  -- disables the row mutation trigger, and PostgreSQL transactionality restores
  -- the trigger state together with data if any statement fails.
  ALTER TABLE habit.completion_events
    DISABLE TRIGGER completion_events_append_only;

  DELETE FROM habit.completion_events
  WHERE workspace_id = target_workspace_id;
  GET DIAGNOSTICS deleted_completion_events = ROW_COUNT;

  ALTER TABLE habit.completion_events
    ENABLE TRIGGER completion_events_append_only;

  DELETE FROM habit.habit_definitions
  WHERE workspace_id = target_workspace_id;
  GET DIAGNOSTICS deleted_habit_definitions = ROW_COUNT;

  RETURN deleted_completion_events + deleted_habit_definitions;
END;
$$;

REVOKE ALL ON FUNCTION habit.erase_workspace_data(uuid) FROM PUBLIC;

COMMENT ON FUNCTION habit.erase_workspace_data(uuid) IS
  'Owner-authorized Habit data-rights erasure; runtime roles require an explicit EXECUTE grant.';

COMMIT;
