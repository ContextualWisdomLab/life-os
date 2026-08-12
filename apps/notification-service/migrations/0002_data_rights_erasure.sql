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
    get_byte(uuid_send(workspace_id), 6) >> 4 = 4
    AND get_byte(uuid_send(workspace_id), 8) >> 6 = 2
  ),
  CONSTRAINT notification_data_rights_receipts_idempotency_uuid_v4 CHECK (
    get_byte(uuid_send(idempotency_key), 6) >> 4 = 4
    AND get_byte(uuid_send(idempotency_key), 8) >> 6 = 2
  ),
  CONSTRAINT notification_data_rights_receipts_request_uuid_v4 CHECK (
    get_byte(uuid_send(request_id), 6) >> 4 = 4
    AND get_byte(uuid_send(request_id), 8) >> 6 = 2
  ),
  CONSTRAINT notification_data_rights_receipts_user_uuid_v4 CHECK (
    get_byte(uuid_send(requested_by_user_id), 6) >> 4 = 4
    AND get_byte(uuid_send(requested_by_user_id), 8) >> 6 = 2
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

CREATE FUNCTION notification_service.erase_workspace_data(
  target_workspace_id uuid,
  target_requested_by_user_id uuid,
  target_request_id uuid,
  target_idempotency_key uuid
)
RETURNS TABLE (
  result_erased_records integer,
  result_receipt_sha256 text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, notification_service
AS $$
DECLARE
  existing_requested_by_user_id uuid;
  existing_request_id uuid;
  existing_erased_records integer;
  existing_receipt_sha256 text;
  deleted_inbox_messages integer := 0;
  deleted_reminder_outcomes integer := 0;
  deleted_reminder_occurrences integer := 0;
  deleted_records integer := 0;
  calculated_receipt_sha256 text;
BEGIN
  IF
    target_workspace_id IS NULL
    OR target_requested_by_user_id IS NULL
    OR target_request_id IS NULL
    OR target_idempotency_key IS NULL
    OR get_byte(uuid_send(target_workspace_id), 6) >> 4 <> 4
    OR get_byte(uuid_send(target_workspace_id), 8) >> 6 <> 2
    OR get_byte(uuid_send(target_requested_by_user_id), 6) >> 4 <> 4
    OR get_byte(uuid_send(target_requested_by_user_id), 8) >> 6 <> 2
    OR get_byte(uuid_send(target_request_id), 6) >> 4 <> 4
    OR get_byte(uuid_send(target_request_id), 8) >> 6 <> 2
    OR get_byte(uuid_send(target_idempotency_key), 6) >> 4 <> 4
    OR get_byte(uuid_send(target_idempotency_key), 8) >> 6 <> 2
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Notification erasure authority identifiers are invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'notification.service:' ||
      target_workspace_id::text || ':' ||
      target_idempotency_key::text,
      0
    )
  );

  SELECT
    requested_by_user_id,
    request_id,
    erased_records,
    receipt_sha256
  INTO
    existing_requested_by_user_id,
    existing_request_id,
    existing_erased_records,
    existing_receipt_sha256
  FROM notification_service.data_rights_erasure_receipts
  WHERE workspace_id = target_workspace_id
    AND idempotency_key = target_idempotency_key;

  IF FOUND THEN
    IF existing_requested_by_user_id <> target_requested_by_user_id
      OR existing_request_id <> target_request_id
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Notification erasure replay authority conflicts';
    END IF;

    RETURN QUERY
    SELECT existing_erased_records, existing_receipt_sha256;
    RETURN;
  END IF;

  DELETE FROM notification_service.inbox_messages
  WHERE workspace_id = target_workspace_id;
  GET DIAGNOSTICS deleted_inbox_messages = ROW_COUNT;

  -- Reminder outcomes remain immutable to ordinary callers. This reviewed,
  -- owner-executed erasure function is the only path that temporarily disables
  -- the row mutation trigger. PostgreSQL transaction rollback restores both
  -- data and trigger state if any following statement fails.
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

  deleted_records :=
    deleted_inbox_messages +
    deleted_reminder_outcomes +
    deleted_reminder_occurrences;

  calculated_receipt_sha256 := encode(
    sha256(
      convert_to(
        concat_ws(
          '|',
          'notification.service',
          target_workspace_id::text,
          target_idempotency_key::text,
          target_request_id::text,
          target_requested_by_user_id::text,
          deleted_records::text
        ),
        'UTF8'
      )
    ),
    'hex'
  );

  INSERT INTO notification_service.data_rights_erasure_receipts (
    workspace_id,
    idempotency_key,
    request_id,
    requested_by_user_id,
    erased_records,
    receipt_sha256,
    erased_at
  ) VALUES (
    target_workspace_id,
    target_idempotency_key,
    target_request_id,
    target_requested_by_user_id,
    deleted_records,
    calculated_receipt_sha256,
    transaction_timestamp()
  );

  RETURN QUERY
  SELECT deleted_records, calculated_receipt_sha256;
END;
$$;

REVOKE ALL ON FUNCTION notification_service.erase_workspace_data(
  uuid,
  uuid,
  uuid,
  uuid
) FROM PUBLIC;

COMMENT ON FUNCTION notification_service.erase_workspace_data(
  uuid,
  uuid,
  uuid,
  uuid
) IS
  'Atomic replay-safe owner-authorized Notification data-rights erasure; runtime roles require an explicit EXECUTE grant.';

COMMIT;
