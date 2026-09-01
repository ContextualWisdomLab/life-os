BEGIN;

ALTER SCHEMA notification_service OWNER TO CURRENT_USER;
ALTER TABLE notification_service.reminder_occurrences OWNER TO CURRENT_USER;
ALTER TABLE notification_service.reminder_outcomes OWNER TO CURRENT_USER;
ALTER TABLE notification_service.inbox_messages OWNER TO CURRENT_USER;
ALTER FUNCTION notification_service.reject_reminder_outcome_mutation() OWNER TO CURRENT_USER;

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

CREATE TABLE notification_service.data_rights_erasure_authorizations (
  backend_process_id integer NOT NULL,
  transaction_id xid8 NOT NULL,
  workspace_id uuid NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT notification_data_rights_erasure_authorizations_primary
    PRIMARY KEY (backend_process_id, transaction_id, workspace_id),
  CONSTRAINT notification_data_rights_authorizations_workspace_uuid_v4 CHECK (
    get_byte(uuid_send(workspace_id), 6) >> 4 = 4
    AND get_byte(uuid_send(workspace_id), 8) >> 6 = 2
  )
);

COMMENT ON TABLE notification_service.data_rights_erasure_authorizations IS
  'Owner-only transaction-local authorization consumed by Notification append-only outcome triggers.';

REVOKE ALL ON TABLE notification_service.data_rights_erasure_authorizations FROM PUBLIC;

CREATE TABLE notification_service.data_rights_workspace_erasures (
  workspace_id uuid NOT NULL,
  requested_by_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  erased_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT notification_data_rights_workspace_erasures_primary
    PRIMARY KEY (workspace_id),
  CONSTRAINT notification_data_rights_workspace_erasures_workspace_uuid_v4 CHECK (
    get_byte(uuid_send(workspace_id), 6) >> 4 = 4
    AND get_byte(uuid_send(workspace_id), 8) >> 6 = 2
  ),
  CONSTRAINT notification_data_rights_workspace_erasures_user_uuid_v4 CHECK (
    get_byte(uuid_send(requested_by_user_id), 6) >> 4 = 4
    AND get_byte(uuid_send(requested_by_user_id), 8) >> 6 = 2
  ),
  CONSTRAINT notification_data_rights_workspace_erasures_request_uuid_v4 CHECK (
    get_byte(uuid_send(request_id), 6) >> 4 = 4
    AND get_byte(uuid_send(request_id), 8) >> 6 = 2
  ),
  CONSTRAINT notification_data_rights_workspace_erasures_idempotency_uuid_v4 CHECK (
    get_byte(uuid_send(idempotency_key), 6) >> 4 = 4
    AND get_byte(uuid_send(idempotency_key), 8) >> 6 = 2
  )
);

COMMENT ON TABLE notification_service.data_rights_workspace_erasures IS
  'Terminal owner-only workspace erasure fence. Notification writes must coordinate on the workspace advisory key and reject a persisted fence.';

REVOKE ALL ON TABLE notification_service.data_rights_workspace_erasures FROM PUBLIC;

CREATE FUNCTION notification_service.guard_erased_workspace_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, notification_service
AS $$
DECLARE
  new_workspace_lock_key bigint;
  old_workspace_lock_key bigint;
BEGIN
  new_workspace_lock_key := hashtextextended(
    'notification.service:workspace:' || NEW.workspace_id::text,
    0
  );

  IF TG_OP = 'UPDATE' THEN
    old_workspace_lock_key := hashtextextended(
      'notification.service:workspace:' || OLD.workspace_id::text,
      0
    );
    IF old_workspace_lock_key < new_workspace_lock_key THEN
      PERFORM pg_advisory_xact_lock_shared(old_workspace_lock_key);
      PERFORM pg_advisory_xact_lock_shared(new_workspace_lock_key);
    ELSIF old_workspace_lock_key > new_workspace_lock_key THEN
      PERFORM pg_advisory_xact_lock_shared(new_workspace_lock_key);
      PERFORM pg_advisory_xact_lock_shared(old_workspace_lock_key);
    ELSE
      PERFORM pg_advisory_xact_lock_shared(new_workspace_lock_key);
    END IF;

    IF EXISTS (
      SELECT 1
      FROM notification_service.data_rights_workspace_erasures
      WHERE workspace_id IN (OLD.workspace_id, NEW.workspace_id)
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'Notification workspace is erased';
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock_shared(new_workspace_lock_key);
    IF EXISTS (
      SELECT 1
      FROM notification_service.data_rights_workspace_erasures
      WHERE workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'Notification workspace is erased';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION notification_service.guard_erased_workspace_write() IS
  'SECURITY DEFINER write fence. Normal Notification inserts and updates take shared workspace advisory locks and reject durable data-rights erasure tombstones; erasure takes the matching exclusive lock.';

REVOKE ALL ON FUNCTION notification_service.guard_erased_workspace_write() FROM PUBLIC;

DROP TRIGGER IF EXISTS reminder_occurrences_workspace_erasure_guard
  ON notification_service.reminder_occurrences;
CREATE TRIGGER reminder_occurrences_workspace_erasure_guard
BEFORE INSERT OR UPDATE ON notification_service.reminder_occurrences
FOR EACH ROW
EXECUTE FUNCTION notification_service.guard_erased_workspace_write();

DROP TRIGGER IF EXISTS reminder_outcomes_workspace_erasure_guard
  ON notification_service.reminder_outcomes;
CREATE TRIGGER reminder_outcomes_workspace_erasure_guard
BEFORE INSERT OR UPDATE ON notification_service.reminder_outcomes
FOR EACH ROW
EXECUTE FUNCTION notification_service.guard_erased_workspace_write();

DROP TRIGGER IF EXISTS inbox_messages_workspace_erasure_guard
  ON notification_service.inbox_messages;
CREATE TRIGGER inbox_messages_workspace_erasure_guard
BEFORE INSERT OR UPDATE ON notification_service.inbox_messages
FOR EACH ROW
EXECUTE FUNCTION notification_service.guard_erased_workspace_write();

CREATE OR REPLACE FUNCTION notification_service.reject_reminder_outcome_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, notification_service
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1
      FROM notification_service.data_rights_erasure_authorizations
      WHERE backend_process_id = pg_backend_pid()
        AND transaction_id = pg_current_xact_id()
        AND workspace_id = OLD.workspace_id
    ) THEN
      RETURN OLD;
    END IF;
  END IF;

  RAISE EXCEPTION 'reminder outcomes are immutable'
    USING ERRCODE = '55000';
END;
$$;

COMMENT ON FUNCTION notification_service.reject_reminder_outcome_mutation() IS
  'SECURITY DEFINER boundary that enforces reminder-outcome immutability; DELETE is allowed only for the same backend, transaction, and workspace authorized by the owner-controlled erasure procedure.';

REVOKE ALL ON FUNCTION notification_service.reject_reminder_outcome_mutation() FROM PUBLIC;

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
  existing_fence_requested_by_user_id uuid;
  existing_fence_request_id uuid;
  existing_fence_idempotency_key uuid;
  workspace_fence_found boolean := false;
  receipt_found boolean := false;
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
      'notification.service:workspace:' || target_workspace_id::text,
      0
    )
  );

  SELECT
    requested_by_user_id,
    request_id,
    idempotency_key
  INTO
    existing_fence_requested_by_user_id,
    existing_fence_request_id,
    existing_fence_idempotency_key
  FROM notification_service.data_rights_workspace_erasures
  WHERE workspace_id = target_workspace_id;
  workspace_fence_found := FOUND;

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
  receipt_found := FOUND;

  IF receipt_found THEN
    IF existing_requested_by_user_id <> target_requested_by_user_id
      OR existing_request_id <> target_request_id
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Notification erasure replay authority conflicts';
    END IF;
    IF NOT workspace_fence_found
      OR existing_fence_requested_by_user_id <> target_requested_by_user_id
      OR existing_fence_request_id <> target_request_id
      OR existing_fence_idempotency_key <> target_idempotency_key
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'Notification erasure replay fence is invalid';
    END IF;

    RETURN QUERY
    SELECT existing_erased_records, existing_receipt_sha256;
    RETURN;
  END IF;

  IF workspace_fence_found THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Notification workspace erasure authority conflicts';
  END IF;

  INSERT INTO notification_service.data_rights_workspace_erasures (
    workspace_id,
    requested_by_user_id,
    request_id,
    idempotency_key
  ) VALUES (
    target_workspace_id,
    target_requested_by_user_id,
    target_request_id,
    target_idempotency_key
  );

  DELETE FROM notification_service.inbox_messages
  WHERE workspace_id = target_workspace_id;
  GET DIAGNOSTICS deleted_inbox_messages = ROW_COUNT;

  INSERT INTO notification_service.data_rights_erasure_authorizations (
    backend_process_id,
    transaction_id,
    workspace_id
  ) VALUES (
    pg_backend_pid(),
    pg_current_xact_id(),
    target_workspace_id
  );

  DELETE FROM notification_service.reminder_outcomes
  WHERE workspace_id = target_workspace_id;
  GET DIAGNOSTICS deleted_reminder_outcomes = ROW_COUNT;

  DELETE FROM notification_service.data_rights_erasure_authorizations
  WHERE backend_process_id = pg_backend_pid()
    AND transaction_id = pg_current_xact_id()
    AND workspace_id = target_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Notification erasure authorization cleanup failed';
  END IF;

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
  'Atomic replay-safe owner-authorized Notification data-rights erasure. It holds the exclusive workspace coordination lock, persists a terminal write fence before deletion, and requires matching fence evidence on replay; runtime roles require an explicit EXECUTE grant.';

COMMIT;
