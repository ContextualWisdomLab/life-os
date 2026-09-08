CREATE TABLE plugin_integration.plugin_delivery_attempt_record (
    authority_version text NOT NULL,
    delivery_id uuid PRIMARY KEY,
    grant_id uuid NOT NULL,
    installation_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    requested_by_user_id uuid NOT NULL,
    delivery_status text NOT NULL DEFAULT 'pending',
    attempt_count smallint NOT NULL DEFAULT 0,
    max_attempts smallint NOT NULL,
    requested_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    next_attempt_at timestamptz NOT NULL,
    terminal_at timestamptz,
    last_outcome_code text,
    CONSTRAINT plugin_delivery_attempt_grant_fk
        FOREIGN KEY (grant_id)
        REFERENCES plugin_integration.plugin_delivery_origin_grant_record (grant_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CONSTRAINT plugin_delivery_attempt_authority_version_check
        CHECK (authority_version = 'life-os.plugin-delivery-attempt.v1'),
    CONSTRAINT plugin_delivery_attempt_delivery_id_uuid_v4_check
        CHECK (
            delivery_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ),
    CONSTRAINT plugin_delivery_attempt_grant_id_uuid_v4_check
        CHECK (
            grant_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ),
    CONSTRAINT plugin_delivery_attempt_installation_id_uuid_v4_check
        CHECK (
            installation_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ),
    CONSTRAINT plugin_delivery_attempt_workspace_id_uuid_v4_check
        CHECK (
            workspace_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ),
    CONSTRAINT plugin_delivery_attempt_requested_user_id_uuid_v4_check
        CHECK (
            requested_by_user_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ),
    CONSTRAINT plugin_delivery_attempt_status_check
        CHECK (delivery_status = 'pending'),
    CONSTRAINT plugin_delivery_attempt_count_check
        CHECK (attempt_count = 0),
    CONSTRAINT plugin_delivery_attempt_max_attempts_check
        CHECK (max_attempts BETWEEN 1 AND 10),
    CONSTRAINT plugin_delivery_attempt_time_check
        CHECK (
            updated_at >= requested_at
            AND next_attempt_at >= requested_at
            AND terminal_at IS NULL
        ),
    CONSTRAINT plugin_delivery_attempt_outcome_check
        CHECK (last_outcome_code IS NULL)
);

COMMENT ON TABLE plugin_integration.plugin_delivery_attempt_record IS
    'Integration-owned durable delivery-attempt admission record; insertion requires matching active delivery-origin grant and active owning installation authority.';

CREATE FUNCTION plugin_integration.require_active_plugin_authority_for_delivery_attempt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM 1
    FROM plugin_integration.plugin_delivery_origin_grant_record AS grant_record
    JOIN plugin_integration.plugin_installation_record AS installation_record
      ON installation_record.installation_id = grant_record.installation_id
     AND installation_record.workspace_id = grant_record.workspace_id
     AND installation_record.installed_by_user_id = grant_record.granted_by_user_id
    WHERE grant_record.grant_id = NEW.grant_id
      AND grant_record.installation_id = NEW.installation_id
      AND grant_record.workspace_id = NEW.workspace_id
      AND grant_record.granted_by_user_id = NEW.requested_by_user_id
      AND grant_record.grant_status = 'active'
      AND grant_record.revoked_at IS NULL
      AND grant_record.granted_at <= NEW.requested_at
      AND installation_record.installation_status = 'active'
      AND installation_record.revoked_at IS NULL
      AND installation_record.installed_at <= NEW.requested_at
    FOR SHARE OF grant_record, installation_record;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'plugin_delivery_attempt_active_authority_check'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'plugin_delivery_attempt_active_authority_check';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER plugin_delivery_attempt_active_authority_trigger
BEFORE INSERT ON plugin_integration.plugin_delivery_attempt_record
FOR EACH ROW
EXECUTE FUNCTION plugin_integration.require_active_plugin_authority_for_delivery_attempt();

CREATE INDEX plugin_delivery_attempt_pending_schedule_index
    ON plugin_integration.plugin_delivery_attempt_record (
        next_attempt_at,
        delivery_id
    )
    WHERE delivery_status = 'pending';

CREATE INDEX plugin_delivery_attempt_scope_index
    ON plugin_integration.plugin_delivery_attempt_record (
        installation_id,
        workspace_id,
        requested_by_user_id,
        grant_id
    );
