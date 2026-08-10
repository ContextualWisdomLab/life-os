CREATE TABLE planning.data_rights_erasure_receipts (
  workspace_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  requested_by_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  erased_records integer NOT NULL CHECK (erased_records >= 0),
  receipt_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_rights_erasure_receipts_pk
    PRIMARY KEY (workspace_id, idempotency_key),
  CONSTRAINT data_rights_erasure_receipts_uuidv4_check CHECK (
    workspace_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND idempotency_key::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND requested_by_user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND request_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT data_rights_erasure_receipts_digest_check
    CHECK (receipt_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX data_rights_erasure_receipts_workspace_created_idx
  ON planning.data_rights_erasure_receipts (workspace_id, created_at DESC);
