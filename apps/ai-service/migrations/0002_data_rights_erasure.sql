BEGIN;

ALTER SCHEMA ai OWNER TO CURRENT_USER;
REVOKE CREATE ON SCHEMA ai FROM PUBLIC;
ALTER TABLE ai.proposal_audit_records OWNER TO CURRENT_USER;
ALTER TABLE ai.proposal_decision_events OWNER TO CURRENT_USER;
ALTER FUNCTION ai.reject_proposal_audit_mutation() OWNER TO CURRENT_USER;

CREATE TABLE ai.data_rights_erasure_receipts (
  workspace_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_id uuid NOT NULL,
  requested_by_user_id uuid NOT NULL,
  erased_records integer NOT NULL,
  receipt_sha256 text NOT NULL,
  erased_at timestamptz NOT NULL,
  CONSTRAINT ai_data_rights_erasure_receipts_primary
    PRIMARY KEY (workspace_id, idempotency_key),
  CONSTRAINT ai_data_rights_receipts_workspace_uuid_v4 CHECK (
    get_byte(uuid_send(workspace_id), 6) >> 4 = 4
    AND get_byte(uuid_send(workspace_id), 8) >> 6 = 2
  ),
  CONSTRAINT ai_data_rights_receipts_idempotency_uuid_v4 CHECK (
    get_byte(uuid_send(idempotency_key), 6) >> 4 = 4
    AND get_byte(uuid_send(idempotency_key), 8) >> 6 = 2
  ),
  CONSTRAINT ai_data_rights_receipts_request_uuid_v4 CHECK (
    get_byte(uuid_send(request_id), 6) >> 4 = 4
    AND get_byte(uuid_send(request_id), 8) >> 6 = 2
  ),
  CONSTRAINT ai_data_rights_receipts_user_uuid_v4 CHECK (
    get_byte(uuid_send(requested_by_user_id), 6) >> 4 = 4
    AND get_byte(uuid_send(requested_by_user_id), 8) >> 6 = 2
  ),
  CONSTRAINT ai_data_rights_receipts_count_nonnegative CHECK (
    erased_records >= 0
  ),
  CONSTRAINT ai_data_rights_receipts_digest_sha256 CHECK (
    receipt_sha256 ~ '^[0-9a-f]{64}$'
  )
);

COMMENT ON TABLE ai.data_rights_erasure_receipts IS
  'Replay evidence for explicitly authorized AI-owned data-rights erasure.';

CREATE TABLE ai.data_rights_erasure_authorizations (
  backend_process_id integer NOT NULL,
  transaction_id xid8 NOT NULL,
  workspace_id uuid NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_data_rights_erasure_authorizations_primary
    PRIMARY KEY (backend_process_id, transaction_id, workspace_id),
  CONSTRAINT ai_data_rights_authorizations_workspace_uuid_v4 CHECK (
    get_byte(uuid_send(workspace_id), 6) >> 4 = 4
    AND get_byte(uuid_send(workspace_id), 8) >> 6 = 2
  )
);

COMMENT ON TABLE ai.data_rights_erasure_authorizations IS
  'Owner-only transaction-local authorization consumed by append-only AI audit triggers.';

REVOKE ALL ON TABLE ai.data_rights_erasure_authorizations FROM PUBLIC;

CREATE OR REPLACE FUNCTION ai.reject_proposal_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ai
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1
      FROM ai.data_rights_erasure_authorizations
      WHERE backend_process_id = pg_backend_pid()
        AND transaction_id = pg_current_xact_id()
        AND workspace_id = OLD.workspace_id
    ) THEN
      RETURN OLD;
    END IF;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'AI proposal audit history is append-only';
END;
$$;

REVOKE ALL ON FUNCTION ai.reject_proposal_audit_mutation() FROM PUBLIC;

CREATE INDEX proposal_decision_events_workspace_recorded_idx
  ON ai.proposal_decision_events (
    workspace_id,
    recorded_at ASC,
    id ASC
  );

CREATE FUNCTION ai.erase_workspace_data(
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
SET search_path = pg_catalog, ai
AS $$
DECLARE
  existing_requested_by_user_id uuid;
  existing_request_id uuid;
  existing_erased_records integer;
  existing_receipt_sha256 text;
  deleted_decisions integer := 0;
  deleted_proposals integer := 0;
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
      MESSAGE = 'AI erasure authority identifiers are invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'ai.service:erase:' || target_workspace_id::text,
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
  FROM ai.data_rights_erasure_receipts
  WHERE workspace_id = target_workspace_id
    AND idempotency_key = target_idempotency_key;

  IF FOUND THEN
    IF existing_requested_by_user_id <> target_requested_by_user_id
      OR existing_request_id <> target_request_id
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'AI erasure replay authority conflicts';
    END IF;

    RETURN QUERY SELECT existing_erased_records, existing_receipt_sha256;
    RETURN;
  END IF;

  INSERT INTO ai.data_rights_erasure_authorizations (
    backend_process_id,
    transaction_id,
    workspace_id
  ) VALUES (
    pg_backend_pid(),
    pg_current_xact_id(),
    target_workspace_id
  );

  DELETE FROM ai.proposal_decision_events
  WHERE workspace_id = target_workspace_id;
  GET DIAGNOSTICS deleted_decisions = ROW_COUNT;

  DELETE FROM ai.proposal_audit_records
  WHERE workspace_id = target_workspace_id;
  GET DIAGNOSTICS deleted_proposals = ROW_COUNT;

  DELETE FROM ai.data_rights_erasure_authorizations
  WHERE backend_process_id = pg_backend_pid()
    AND transaction_id = pg_current_xact_id()
    AND workspace_id = target_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'AI erasure authorization cleanup failed';
  END IF;

  deleted_records := deleted_decisions + deleted_proposals;

  calculated_receipt_sha256 := encode(
    sha256(
      convert_to(
        concat_ws(
          '|',
          'ai.service',
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

  INSERT INTO ai.data_rights_erasure_receipts (
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

  RETURN QUERY SELECT deleted_records, calculated_receipt_sha256;
END;
$$;

REVOKE ALL ON FUNCTION ai.erase_workspace_data(uuid, uuid, uuid, uuid) FROM PUBLIC;

COMMENT ON FUNCTION ai.erase_workspace_data(uuid, uuid, uuid, uuid) IS
  'Atomic replay-safe owner-authorized AI data-rights erasure; runtime roles require an explicit EXECUTE grant.';

COMMIT;