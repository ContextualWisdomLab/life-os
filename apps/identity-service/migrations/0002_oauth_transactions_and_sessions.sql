CREATE TABLE identity.oauth_transactions (
  id uuid PRIMARY KEY,
  state_hash text NOT NULL UNIQUE CHECK (length(btrim(state_hash)) >= 43),
  provider text NOT NULL CHECK (provider IN ('google', 'github')),
  browser_session_hash text NOT NULL CHECK (length(btrim(browser_session_hash)) >= 43),
  code_verifier_ciphertext bytea NOT NULL,
  redirect_uri text NOT NULL CHECK (length(btrim(redirect_uri)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT oauth_transaction_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT oauth_transaction_consumed_after_creation CHECK (
    consumed_at IS NULL OR consumed_at >= created_at
  )
);

CREATE INDEX oauth_transactions_expiry_idx
  ON identity.oauth_transactions (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE identity.workspaces
  ADD CONSTRAINT workspaces_id_owner_unique UNIQUE (id, owner_user_id);

CREATE TABLE identity.sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (length(btrim(token_hash)) >= 43),
  rotated_from_id uuid REFERENCES identity.sessions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT sessions_workspace_owner_fk
    FOREIGN KEY (workspace_id, user_id)
    REFERENCES identity.workspaces (id, owner_user_id)
    ON DELETE CASCADE,
  CONSTRAINT session_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT session_revoked_after_creation CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  )
);

CREATE INDEX sessions_user_active_idx
  ON identity.sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX sessions_workspace_active_idx
  ON identity.sessions (workspace_id, expires_at DESC)
  WHERE revoked_at IS NULL;
