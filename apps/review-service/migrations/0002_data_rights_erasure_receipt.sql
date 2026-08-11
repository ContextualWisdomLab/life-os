CREATE TABLE IF NOT EXISTS guided_review.data_rights_erasure_receipt (
  idempotency_key UUID NOT NULL,
  workspace_id UUID NOT NULL,
  requested_by_user_id UUID NOT NULL,
  request_id UUID NOT NULL,
  erased_records INTEGER NOT NULL,
  receipt_sha256 TEXT NOT NULL,
  erased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT data_rights_erasure_receipt_primary_key PRIMARY KEY (idempotency_key),
  CONSTRAINT data_rights_erasure_receipt_idempotency_uuid_v4 CHECK (
    idempotency_key::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT data_rights_erasure_receipt_workspace_uuid_v4 CHECK (
    workspace_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT data_rights_erasure_receipt_requesting_user_uuid_v4 CHECK (
    requested_by_user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT data_rights_erasure_receipt_request_uuid_v4 CHECK (
    request_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT data_rights_erasure_receipt_count_nonnegative CHECK (
    erased_records >= 0
  ),
  CONSTRAINT data_rights_erasure_receipt_digest_valid CHECK (
    receipt_sha256 ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS data_rights_erasure_receipt_workspace_idx
  ON guided_review.data_rights_erasure_receipt (
    workspace_id,
    erased_at DESC,
    idempotency_key
  );
