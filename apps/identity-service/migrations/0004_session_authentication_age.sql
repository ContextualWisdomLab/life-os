ALTER TABLE identity.sessions
  ADD COLUMN authenticated_at timestamptz;

UPDATE identity.sessions
SET authenticated_at = created_at
WHERE authenticated_at IS NULL;

ALTER TABLE identity.sessions
  ALTER COLUMN authenticated_at SET NOT NULL,
  ADD CONSTRAINT sessions_authentication_not_after_creation
    CHECK (authenticated_at <= created_at);
