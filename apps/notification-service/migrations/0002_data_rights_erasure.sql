BEGIN;

CREATE TABLE notification_service.data_rights_erasure_receipts (
  workspace_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_id uuid NOT NULL,
  requested_by_user_id uuid NOT NULL,
  erased_records integer NOT NULL,
  receipt_sha256 text NOT NULL,
  erased_at timestamptz NOT NULL,
  CONSTRAINT notification_data_rights_erasure_receipts_primary
    PRIMARY KEY (workspace_id, idempotency_key),
  CONSTRAINT notification_data_rights_receipts_workspace_uuid_v4 CHECK (
    workspace_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT notification_data_rights_receipts_idempotency_uuid_v4 CHECK (
    idempotency_key::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT notification_data_rights_receipts_request_uuid_v4 CHECK (
    request_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT notification_data_rights_receipts_user_uuid_v4 CHECK (
    requested_by_user_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT notification_data_rights_receipts_count_nonnegative CHECK (
    erased_records >= 0
  ),
  CONSTRAINT notification_data_rights_receipts_digest_sha256 CHECK (
    receipt_sha256 ~ '^[0-9a-f]{64}$'
  )
);

COMMENT ON TABLE notification_service.data_rights_erasure_receipts IS
  'Replay evidence for explicitly authorized Notification-owned data-rights erasure.';

CREATE FUNCTION notification_service.erase_workspace_data(target_workspace_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, notification_service
AS $$
DECLARE
  deleted_inbox_messages integer := 0;
  deleted_reminder_outcomes integer := 0;
  deleted_reminder_occurrences integer := 0;
BEGIN
  IF target_workspace_id IS NULL OR target_workspace_id::text !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Notification erasure workspace identifier is invalid';
  END IF;

  DELETE FROM notification_service.inbox_messages
  WHERE workspace_id = target_workspace_id;
  GET DIAGNOSTICS deleted_inbox_messages = ROW_COUNT;

  -- Reminder outcomes are immutable to ordinary callers. The reviewed,
  -- owner-executed erasure function is the only path that temporarily disables
  -- the row mutation guard. Transaction rollback restores both data and trigger
  -- state if any following statement fails.
  ALTER TABLE notification_service.reminder_outcomes
    DISABLE TRIGGER reminder_outcomes_row_mutation_guard;

  DELETE FROM notification_service.reminder_outcomes
  WHERE workspace_id = target_workspace_id;
  GET DIAGNOSTICS deleted_reminder_outcomes = ROW_COUNT;

  ALTER TABLE notification_service.reminder_outcomes
    ENABLE TRIGGER reminder_outcomes_row_mutation_guard;

  DELETE FROM notification_service.reminder_occurrences
  WHERE workspace_id = target_workspace_id;
  GET DIAGNOSTICS deleted_reminder_occurrences = ROW_COUNT;

  RETURN
    deleted_inbox_messages +
    deleted_reminder_outcomes +
    deleted_reminder_occurrences;
END;
$$;

REVOKE ALL ON FUNCTION notification_service.erase_workspace_data(uuid)
  FROM PUBLIC;

COMMENT ON FUNCTION notification_service.erase_workspace_data(uuid) IS
  'Owner-authorized Notification data-rights erasure; runtime roles require an explicit EXECUTE grant.';

COMMIT;
