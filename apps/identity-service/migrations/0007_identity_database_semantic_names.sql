BEGIN;

-- PostgreSQL table/column renames are metadata-only but take ACCESS EXCLUSIVE locks.
-- Fail fast instead of extending an application write outage when a busy deployment
-- cannot acquire the complete rename set promptly.
SET LOCAL lock_timeout = '5s';

ALTER TABLE identity.users RENAME TO user_accounts;
ALTER TABLE identity.workspaces RENAME TO identity_workspaces;
ALTER TABLE identity.sessions RENAME TO authentication_sessions;

ALTER TABLE identity.user_accounts
  RENAME COLUMN id TO user_account_id;

ALTER TABLE identity.external_identities
  RENAME COLUMN id TO external_identity_id;
ALTER TABLE identity.external_identities
  RENAME COLUMN user_id TO user_account_id;
ALTER TABLE identity.external_identities
  RENAME COLUMN provider TO identity_provider;

ALTER TABLE identity.identity_workspaces
  RENAME COLUMN id TO identity_workspace_id;
ALTER TABLE identity.identity_workspaces
  RENAME COLUMN owner_user_id TO owner_user_account_id;
ALTER TABLE identity.identity_workspaces
  RENAME COLUMN name TO workspace_name;
ALTER TABLE identity.identity_workspaces
  RENAME COLUMN kind TO workspace_kind;

ALTER TABLE identity.authentication_sessions
  RENAME COLUMN id TO authentication_session_id;
ALTER TABLE identity.authentication_sessions
  RENAME COLUMN user_id TO user_account_id;
ALTER TABLE identity.authentication_sessions
  RENAME COLUMN workspace_id TO identity_workspace_id;
ALTER TABLE identity.authentication_sessions
  RENAME COLUMN rotated_from_id TO rotated_from_session_id;

ALTER TABLE identity.oauth_transactions
  RENAME COLUMN id TO oauth_transaction_id;
ALTER TABLE identity.oauth_transactions
  RENAME COLUMN provider TO identity_provider;

ALTER TABLE identity.user_accounts
  RENAME CONSTRAINT users_pkey TO user_accounts_pkey;
ALTER TABLE identity.user_accounts
  RENAME CONSTRAINT users_id_uuid_v4 TO user_account_id_uuid_v4;

ALTER TABLE identity.external_identities
  RENAME CONSTRAINT external_identities_user_id_fkey TO external_identities_user_account_fk;
ALTER TABLE identity.external_identities
  RENAME CONSTRAINT external_identities_id_uuid_v4 TO external_identity_id_uuid_v4;

ALTER TABLE identity.identity_workspaces
  RENAME CONSTRAINT workspaces_pkey TO identity_workspaces_pkey;
ALTER TABLE identity.identity_workspaces
  RENAME CONSTRAINT workspaces_owner_user_id_fkey TO identity_workspaces_owner_user_account_fk;
ALTER TABLE identity.identity_workspaces
  RENAME CONSTRAINT workspaces_id_owner_unique TO identity_workspace_owner_unique;
ALTER TABLE identity.identity_workspaces
  RENAME CONSTRAINT workspaces_id_uuid_v4 TO identity_workspace_id_uuid_v4;

ALTER TABLE identity.authentication_sessions
  RENAME CONSTRAINT sessions_pkey TO authentication_sessions_pkey;
ALTER TABLE identity.authentication_sessions
  RENAME CONSTRAINT sessions_user_id_fkey TO authentication_sessions_user_account_fk;
ALTER TABLE identity.authentication_sessions
  RENAME CONSTRAINT sessions_rotated_from_id_fkey TO authentication_sessions_rotated_from_session_fk;
ALTER TABLE identity.authentication_sessions
  RENAME CONSTRAINT sessions_token_hash_key TO authentication_sessions_token_hash_key;
ALTER TABLE identity.authentication_sessions
  RENAME CONSTRAINT sessions_expiry_after_creation TO authentication_session_expiry_after_creation;
ALTER TABLE identity.authentication_sessions
  RENAME CONSTRAINT sessions_revocation_after_creation TO authentication_session_revocation_after_creation;
ALTER TABLE identity.authentication_sessions
  RENAME CONSTRAINT sessions_workspace_owner_fk TO authentication_session_workspace_owner_fk;
ALTER TABLE identity.authentication_sessions
  RENAME CONSTRAINT sessions_authentication_not_after_creation TO authentication_session_authentication_not_after_creation;
ALTER TABLE identity.authentication_sessions
  RENAME CONSTRAINT sessions_id_uuid_v4 TO authentication_session_id_uuid_v4;

ALTER TABLE identity.oauth_transactions
  RENAME CONSTRAINT oauth_transactions_id_uuid_v4 TO oauth_transaction_id_uuid_v4;

ALTER INDEX identity.external_identities_user_idx
  RENAME TO external_identities_user_account_idx;
ALTER INDEX identity.workspaces_owner_idx
  RENAME TO identity_workspaces_owner_account_idx;
ALTER INDEX identity.sessions_active_user_idx
  RENAME TO authentication_sessions_active_user_account_idx;
ALTER INDEX identity.sessions_active_workspace_idx
  RENAME TO authentication_sessions_active_workspace_idx;

COMMIT;
