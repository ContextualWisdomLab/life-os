CREATE OR REPLACE FUNCTION plugin_integration.require_plugin_delivery_attempt_control_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    control_changed BOOLEAN := NEW.control_sequence <> OLD.control_sequence;
BEGIN
    IF NOT control_changed
       AND OLD.delivery_status NOT IN ('paused', 'dead_lettered')
       AND NEW.delivery_status NOT IN ('paused', 'dead_lettered') THEN
        RETURN NEW;
    END IF;

    IF NEW.control_sequence <> OLD.control_sequence + 1 THEN
        RAISE EXCEPTION 'plugin_delivery_attempt_control_sequence_check'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'plugin_delivery_attempt_control_sequence_check';
    END IF;

    IF NEW.updated_at < OLD.updated_at THEN
        RAISE EXCEPTION 'plugin_delivery_attempt_control_chronology_check'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'plugin_delivery_attempt_control_chronology_check';
    END IF;

    IF NEW.delivery_id <> OLD.delivery_id
       OR NEW.grant_id <> OLD.grant_id
       OR NEW.installation_id <> OLD.installation_id
       OR NEW.workspace_id <> OLD.workspace_id
       OR NEW.requested_by_user_id <> OLD.requested_by_user_id
       OR NEW.attempt_count <> OLD.attempt_count
       OR NEW.max_attempts <> OLD.max_attempts
       OR NEW.requested_at <> OLD.requested_at
       OR NEW.last_outcome_code IS DISTINCT FROM OLD.last_outcome_code
       OR NEW.claim_token_digest IS DISTINCT FROM OLD.claim_token_digest
       OR NEW.claim_started_at IS DISTINCT FROM OLD.claim_started_at
       OR NEW.claim_expires_at IS DISTINCT FROM OLD.claim_expires_at THEN
        RAISE EXCEPTION 'plugin_delivery_attempt_control_identity_check'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'plugin_delivery_attempt_control_identity_check';
    END IF;

    IF OLD.delivery_status = 'pending' AND NEW.delivery_status = 'paused' THEN
        IF OLD.claim_token_digest IS NOT NULL
           OR OLD.claim_started_at IS NOT NULL
           OR OLD.claim_expires_at IS NOT NULL
           OR NEW.next_attempt_at IS DISTINCT FROM OLD.next_attempt_at
           OR NEW.terminal_at IS DISTINCT FROM OLD.terminal_at THEN
            RAISE EXCEPTION 'plugin_delivery_attempt_pause_transition_check'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'plugin_delivery_attempt_pause_transition_check';
        END IF;
    ELSIF OLD.delivery_status = 'paused' AND NEW.delivery_status = 'pending' THEN
        IF NEW.next_attempt_at IS DISTINCT FROM NEW.updated_at
           OR NEW.terminal_at IS DISTINCT FROM OLD.terminal_at THEN
            RAISE EXCEPTION 'plugin_delivery_attempt_resume_transition_check'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'plugin_delivery_attempt_resume_transition_check';
        END IF;
    ELSIF OLD.delivery_status = 'failed' AND NEW.delivery_status = 'dead_lettered' THEN
        IF OLD.attempt_count <> OLD.max_attempts
           OR OLD.last_outcome_code <> 'attempt_limit'
           OR OLD.next_attempt_at IS NOT NULL
           OR OLD.terminal_at IS NULL
           OR NEW.next_attempt_at IS DISTINCT FROM OLD.next_attempt_at
           OR NEW.terminal_at IS DISTINCT FROM OLD.terminal_at THEN
            RAISE EXCEPTION 'plugin_delivery_attempt_dead_letter_transition_check'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'plugin_delivery_attempt_dead_letter_transition_check';
        END IF;
    ELSE
        RAISE EXCEPTION 'plugin_delivery_attempt_control_transition_check'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'plugin_delivery_attempt_control_transition_check';
    END IF;

    RETURN NEW;
END;
$$;
