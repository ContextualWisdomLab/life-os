ALTER TABLE identity.sessions
  VALIDATE CONSTRAINT sessions_authentication_present;

ALTER TABLE identity.sessions
  VALIDATE CONSTRAINT sessions_authentication_not_after_creation;

ALTER TABLE identity.sessions
  ALTER COLUMN authenticated_at SET NOT NULL;

ALTER TABLE identity.sessions
  DROP CONSTRAINT sessions_authentication_present;
