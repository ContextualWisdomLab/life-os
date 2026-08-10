ALTER TABLE plugin_integration.plugin_installation_record
    ADD CONSTRAINT plugin_installation_authority_unique
    UNIQUE (installation_id, workspace_id, installed_by_user_id);

CREATE TABLE plugin_integration.plugin_credential_binding_record (
    credential_binding_id uuid PRIMARY KEY,
    installation_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    installed_by_user_id uuid NOT NULL,
    credential_name text NOT NULL,
    secret_reference text NOT NULL,
    credential_status text NOT NULL DEFAULT 'active',
    bound_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CONSTRAINT plugin_credential_installation_authority_fk
        FOREIGN KEY (installation_id, workspace_id, installed_by_user_id)
        REFERENCES plugin_integration.plugin_installation_record
            (installation_id, workspace_id, installed_by_user_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CONSTRAINT plugin_credential_name_format_check
        CHECK (credential_name ~ '^[a-z][a-z0-9._-]{0,127}$'),
    CONSTRAINT plugin_credential_secret_reference_length_check
        CHECK (char_length(secret_reference) BETWEEN 16 AND 512),
    CONSTRAINT plugin_credential_secret_reference_format_check
        CHECK (secret_reference !~ '[[:cntrl:][:space:]]'),
    CONSTRAINT plugin_credential_status_check
        CHECK (credential_status IN ('active', 'revoked')),
    CONSTRAINT plugin_credential_lifecycle_check
        CHECK (
            (credential_status = 'active' AND revoked_at IS NULL)
            OR (credential_status = 'revoked' AND revoked_at IS NOT NULL)
        ),
    CONSTRAINT plugin_credential_revocation_time_check
        CHECK (revoked_at IS NULL OR revoked_at >= bound_at),
    CONSTRAINT plugin_credential_slot_unique
        UNIQUE (
            installation_id,
            workspace_id,
            installed_by_user_id,
            credential_name
        )
);

CREATE INDEX plugin_credential_authority_status_index
    ON plugin_integration.plugin_credential_binding_record (
        workspace_id,
        installed_by_user_id,
        credential_status
    );
