CREATE TABLE identity.oauth_transactions (
  id uuid PRIMARY KEY,
  state_hash text NOT NULL UNIQUE CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  provider text NOT NULL CHECK (provider IN ('google', 'github')),
  browser_session_hash text NOT NULL CHECK (browser_session_hash ~ '^[0-9a-f]{64}$'),
  code_verifier_ciphertext bytea NOT NULL,
  nonce_ciphertext bytea,
  redirect_uri text NOT NULL CHECK (length(btrim(redirect_uri)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT oauth_transaction_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT oauth_transaction_consumed_after_creation CHECK (
    consumed_at IS NULL OR consumed_at >= created_at
  ),
  CONSTRAINT oauth_transaction_nonce_by_provider CHECK (
    (provider = 'google' AND nonce_ciphertext IS NOT NULL)
    OR (provider = 'github' AND nonce_ciphertext IS NULL)
  )
);

CREATE INDEX oauth_transactions_expiry_idx
  ON identity.oauth_transactions (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE identity.workspaces
  ADD CONSTRAINT workspaces_id_owner_unique UNIQUE (id, owner_user_id);

ALTER TABLE identity.sessions
  ADD COLUMN workspace_id uuid,
  ADD COLUMN rotated_from_id uuid REFERENCES identity.sessions(id) ON DELETE SET NULL;

UPDATE identity.sessions AS session
SET workspace_id = workspace.id
FROM identity.workspaces AS workspace
WHERE workspace.owner_user_id = session.user_id
  AND workspace.kind = 'personal';

ALTER TABLE identity.sessions
  ALTER COLUMN workspace_id SET NOT NULL,
  ADD CONSTRAINT sessions_workspace_owner_fk
    FOREIGN KEY (workspace_id, user_id)
    REFERENCES identity.workspaces (id, owner_user_id)
    ON DELETE CASCADE;

CREATE INDEX sessions_active_workspace_idx
  ON identity.sessions (workspace_id, expires_at)
  WHERE revoked_at IS NULL;
