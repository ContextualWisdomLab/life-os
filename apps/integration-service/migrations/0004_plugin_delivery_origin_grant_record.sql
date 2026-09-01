CREATE TABLE plugin_integration.plugin_delivery_origin_grant_record (
    authority_version text NOT NULL,
    grant_id uuid PRIMARY KEY,
    installation_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    granted_by_user_id uuid NOT NULL,
    origin_uri text NOT NULL,
    grant_status text NOT NULL DEFAULT 'active',
    granted_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CONSTRAINT plugin_delivery_origin_installation_authority_fk
        FOREIGN KEY (installation_id, workspace_id, granted_by_user_id)
        REFERENCES plugin_integration.plugin_installation_record
            (installation_id, workspace_id, installed_by_user_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CONSTRAINT plugin_delivery_origin_authority_version_check
        CHECK (authority_version = 'life-os.plugin-delivery-origin.v1'),
    CONSTRAINT plugin_delivery_origin_grant_id_uuid_v4_check
        CHECK (
            grant_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ),
    CONSTRAINT plugin_delivery_origin_installation_id_uuid_v4_check
        CHECK (
            installation_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ),
    CONSTRAINT plugin_delivery_origin_workspace_id_uuid_v4_check
        CHECK (
            workspace_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ),
    CONSTRAINT plugin_delivery_origin_granted_user_id_uuid_v4_check
        CHECK (
            granted_by_user_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ),
    CONSTRAINT plugin_delivery_origin_uri_length_check
        CHECK (char_length(origin_uri) BETWEEN 9 AND 512),
    CONSTRAINT plugin_delivery_origin_uri_format_check
        CHECK (
            origin_uri ~ '^https://[^/?#\\]+$'
            AND origin_uri !~ '[[:cntrl:][:space:]]'
            AND origin_uri !~ '@'
            AND origin_uri !~ ':0$'
        ),
    CONSTRAINT plugin_delivery_origin_status_check
        CHECK (grant_status IN ('active', 'revoked')),
    CONSTRAINT plugin_delivery_origin_lifecycle_check
        CHECK (
            (grant_status = 'active' AND revoked_at IS NULL)
            OR (grant_status = 'revoked' AND revoked_at IS NOT NULL)
        ),
    CONSTRAINT plugin_delivery_origin_revocation_time_check
        CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

CREATE INDEX plugin_delivery_origin_authority_status_index
    ON plugin_integration.plugin_delivery_origin_grant_record (
        installation_id,
        workspace_id,
        granted_by_user_id,
        grant_status
    );
