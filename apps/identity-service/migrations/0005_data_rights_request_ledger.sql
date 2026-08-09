CREATE TABLE identity.data_rights_requests (
  request_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES identity.workspaces(id) ON DELETE CASCADE,
  requested_by_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  request_kind text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_digest character(64) NOT NULL,
  request_status text NOT NULL DEFAULT 'pending',
  receipt_digest character(64),
  requested_at timestamptz NOT NULL,
  completed_at timestamptz,
  CONSTRAINT data_rights_request_kind_valid
    CHECK (request_kind IN ('export', 'erasure')),
  CONSTRAINT data_rights_request_digest_valid
    CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT data_rights_request_status_valid
    CHECK (request_status IN ('pending', 'completed')),
  CONSTRAINT data_rights_receipt_digest_valid
    CHECK (receipt_digest IS NULL OR receipt_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT data_rights_request_completion_consistent
    CHECK (
      (request_status = 'pending' AND receipt_digest IS NULL AND completed_at IS NULL)
      OR
      (request_status = 'completed' AND receipt_digest IS NOT NULL AND completed_at IS NOT NULL)
    ),
  CONSTRAINT data_rights_request_time_order
    CHECK (completed_at IS NULL OR completed_at >= requested_at),
  CONSTRAINT data_rights_workspace_idempotency_unique
    UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX data_rights_requests_workspace_time_idx
  ON identity.data_rights_requests (workspace_id, requested_at DESC);
