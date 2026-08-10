CREATE SCHEMA IF NOT EXISTS plugin_integration;

CREATE FUNCTION plugin_integration.capability_array_is_valid(capability_values text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
    SELECT
        COALESCE(
            bool_and(char_length(capability_name) BETWEEN 1 AND 256),
            true
        )
        AND cardinality(capability_values) = (
            SELECT count(DISTINCT capability_name COLLATE "C")
            FROM unnest(capability_values) AS capability_name
        )
        AND capability_values = ARRAY(
            SELECT capability_name
            FROM unnest(capability_values) AS capability_name
            ORDER BY capability_name COLLATE "C"
        );
$$;

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
    CONSTRAINT plugin_installation_id_uuid_v4 CHECK (
        installation_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ),
    CONSTRAINT plugin_installation_workspace_id_uuid_v4 CHECK (
        workspace_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ),
    CONSTRAINT plugin_installation_user_id_uuid_v4 CHECK (
        installed_by_user_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ),
    CONSTRAINT plugin_installation_plugin_id_length CHECK (
        char_length(plugin_id) BETWEEN 1 AND 256
    ),
    CONSTRAINT plugin_installation_contract_version_length CHECK (
        char_length(plugin_contract_version) BETWEEN 1 AND 128
    ),
    CONSTRAINT plugin_installation_manifest_sha256 CHECK (
        char_length(manifest_sha256) = 64
        AND manifest_sha256 ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT plugin_installation_capability_count CHECK (
        cardinality(granted_capabilities) BETWEEN 0 AND 32
    ),
    CONSTRAINT plugin_installation_capability_array CHECK (
        array_position(granted_capabilities, NULL) IS NULL
        AND plugin_integration.capability_array_is_valid(granted_capabilities)
    ),
    CONSTRAINT plugin_installation_status_valid CHECK (
        installation_status IN ('active', 'revoked')
    ),
    CONSTRAINT plugin_installation_lifecycle_consistency CHECK (
        (revoked_at IS NULL OR revoked_at >= installed_at)
        AND (
            (installation_status = 'active' AND revoked_at IS NULL)
            OR (installation_status = 'revoked' AND revoked_at IS NOT NULL)
        )
    )
);

CREATE INDEX plugin_installation_workspace_index
    ON plugin_integration.plugin_installation_record (workspace_id, installation_status);
