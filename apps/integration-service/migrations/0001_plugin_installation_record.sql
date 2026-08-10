CREATE SCHEMA IF NOT EXISTS plugin_integration;

CREATE TABLE plugin_integration.plugin_installation_record (
    installation_id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    installed_by_user_id uuid NOT NULL,
    plugin_id text NOT NULL,
    plugin_contract_version text NOT NULL,
    manifest_sha256 text NOT NULL,
    granted_capabilities text[] NOT NULL,
    installation_status text NOT NULL DEFAULT 'active',
    installed_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (char_length(plugin_id) BETWEEN 1 AND 256),
    CHECK (char_length(plugin_contract_version) BETWEEN 1 AND 128),
    CHECK (char_length(manifest_sha256) = 64),
    CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
    CHECK (cardinality(granted_capabilities) BETWEEN 0 AND 32),
    CHECK (installation_status IN ('active', 'revoked')),
    CHECK (revoked_at IS NULL OR revoked_at >= installed_at),
    CHECK (
        (installation_status = 'active' AND revoked_at IS NULL)
        OR (installation_status = 'revoked' AND revoked_at IS NOT NULL)
    )
);

CREATE INDEX plugin_installation_workspace_index
    ON plugin_integration.plugin_installation_record (workspace_id, installation_status);
