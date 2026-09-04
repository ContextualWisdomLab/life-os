CREATE FUNCTION plugin_integration.require_active_plugin_installation_for_credential()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM 1
    FROM plugin_integration.plugin_installation_record
    WHERE installation_id = NEW.installation_id
      AND workspace_id = NEW.workspace_id
      AND installed_by_user_id = NEW.installed_by_user_id
      AND installation_status = 'active'
      AND revoked_at IS NULL
      AND installed_at <= NEW.bound_at
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'plugin_credential_active_installation_check'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'plugin_credential_active_installation_check';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER plugin_credential_active_installation_trigger
BEFORE INSERT ON plugin_integration.plugin_credential_binding_record
FOR EACH ROW
EXECUTE FUNCTION plugin_integration.require_active_plugin_installation_for_credential();
