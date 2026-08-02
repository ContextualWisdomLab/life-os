CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE identity.users (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.external_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'github')),
  provider_subject text NOT NULL CHECK (length(btrim(provider_subject)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_identity_provider_subject_unique UNIQUE (provider, provider_subject)
);

CREATE TABLE identity.workspaces (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  kind text NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_personal_workspace_per_owner UNIQUE (owner_user_id, kind)
);

CREATE INDEX external_identities_user_idx
  ON identity.external_identities (user_id);

CREATE INDEX workspaces_owner_idx
  ON identity.workspaces (owner_user_id);
