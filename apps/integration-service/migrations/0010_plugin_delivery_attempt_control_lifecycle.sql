ALTER TABLE plugin_integration.plugin_delivery_attempt_record
    ADD COLUMN control_sequence INTEGER NOT NULL DEFAULT 0
        CHECK (control_sequence >= 0),
    DROP CONSTRAINT plugin_delivery_attempt_lifecycle_shape_check;

ALTER TABLE plugin_integration.plugin_delivery_attempt_record
    ADD CONSTRAINT plugin_delivery_attempt_lifecycle_shape_check
        CHECK (
            (
                delivery_status = 'pending'
                AND attempt_count = 0
                AND next_attempt_at IS NOT NULL
                AND terminal_at IS NULL
                AND last_outcome_code IS NULL
                AND claim_token_digest IS NULL
                AND claim_started_at IS NULL
                AND claim_expires_at IS NULL
            )
            OR
            (
                delivery_status = 'pending'
                AND attempt_count BETWEEN 1 AND max_attempts
                AND next_attempt_at IS NOT NULL
                AND terminal_at IS NULL
                AND (
                    last_outcome_code IS NULL
                    OR last_outcome_code = 'retryable_failure'
                )
                AND claim_token_digest IS NOT NULL
                AND claim_started_at IS NOT NULL
                AND claim_expires_at IS NOT NULL
            )
            OR
            (
                delivery_status = 'pending'
                AND attempt_count BETWEEN 1 AND max_attempts - 1
                AND next_attempt_at IS NOT NULL
                AND terminal_at IS NULL
                AND last_outcome_code = 'retryable_failure'
                AND claim_token_digest IS NULL
                AND claim_started_at IS NULL
                AND claim_expires_at IS NULL
            )
            OR
            (
                delivery_status = 'paused'
                AND (
                    (attempt_count = 0 AND last_outcome_code IS NULL)
                    OR (
                        attempt_count BETWEEN 1 AND max_attempts - 1
                        AND last_outcome_code = 'retryable_failure'
                    )
                )
                AND next_attempt_at IS NOT NULL
                AND terminal_at IS NULL
                AND claim_token_digest IS NULL
                AND claim_started_at IS NULL
                AND claim_expires_at IS NULL
            )
            OR
            (
                delivery_status = 'failed'
                AND attempt_count = max_attempts
                AND next_attempt_at IS NULL
                AND terminal_at = updated_at
                AND last_outcome_code = 'attempt_limit'
                AND claim_token_digest IS NULL
                AND claim_started_at IS NULL
                AND claim_expires_at IS NULL
            )
            OR
            (
                delivery_status = 'dead_lettered'
                AND attempt_count = max_attempts
                AND next_attempt_at IS NULL
                AND terminal_at IS NOT NULL
                AND terminal_at <= updated_at
                AND last_outcome_code = 'attempt_limit'
                AND claim_token_digest IS NULL
                AND claim_started_at IS NULL
                AND claim_expires_at IS NULL
            )
        );

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

CREATE TRIGGER plugin_delivery_attempt_control_transition
BEFORE UPDATE ON plugin_integration.plugin_delivery_attempt_record
FOR EACH ROW
EXECUTE FUNCTION plugin_integration.require_plugin_delivery_attempt_control_transition();

CREATE TABLE plugin_integration.plugin_delivery_attempt_control_record (
    authority_version TEXT NOT NULL
        CHECK (authority_version = 'life-os.plugin-delivery-attempt-control.v1'),
    delivery_id UUID NOT NULL
        REFERENCES plugin_integration.plugin_delivery_attempt_record (delivery_id),
    workspace_id UUID NOT NULL,
    requested_by_user_id UUID NOT NULL,
    control_sequence INTEGER NOT NULL CHECK (control_sequence >= 1),
    control_code TEXT NOT NULL
        CHECK (control_code IN ('pause', 'resume', 'dead_letter')),
    delivery_status TEXT NOT NULL
        CHECK (delivery_status IN ('paused', 'pending', 'dead_lettered')),
    occurred_at TIMESTAMPTZ NOT NULL,
    next_attempt_at TIMESTAMPTZ,
    terminal_at TIMESTAMPTZ,
    PRIMARY KEY (delivery_id, control_sequence)
);

CREATE OR REPLACE FUNCTION plugin_integration.require_plugin_delivery_attempt_control_source_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'plugin_delivery_attempt_control_source_transition_check'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'plugin_delivery_attempt_control_source_transition_check';
    END IF;

    PERFORM 1
    FROM plugin_integration.plugin_delivery_attempt_record AS attempt
    WHERE attempt.delivery_id = NEW.delivery_id
      AND attempt.workspace_id = NEW.workspace_id
      AND attempt.requested_by_user_id = NEW.requested_by_user_id
      AND attempt.control_sequence = NEW.control_sequence
      AND attempt.delivery_status = NEW.delivery_status
      AND attempt.updated_at = NEW.occurred_at
      AND attempt.next_attempt_at IS NOT DISTINCT FROM NEW.next_attempt_at
      AND attempt.terminal_at IS NOT DISTINCT FROM NEW.terminal_at
      AND (
          (NEW.control_code = 'pause' AND NEW.delivery_status = 'paused')
          OR (NEW.control_code = 'resume' AND NEW.delivery_status = 'pending')
          OR (
              NEW.control_code = 'dead_letter'
              AND NEW.delivery_status = 'dead_lettered'
              AND attempt.attempt_count = attempt.max_attempts
              AND attempt.last_outcome_code = 'attempt_limit'
          )
      )
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'plugin_delivery_attempt_control_source_transition_check'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'plugin_delivery_attempt_control_source_transition_check';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER plugin_delivery_attempt_control_source_transition
BEFORE INSERT ON plugin_integration.plugin_delivery_attempt_control_record
FOR EACH ROW
EXECUTE FUNCTION plugin_integration.require_plugin_delivery_attempt_control_source_transition();

CREATE OR REPLACE FUNCTION plugin_integration.record_plugin_delivery_attempt_control()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    applied_control_code TEXT;
BEGIN
    IF NEW.control_sequence = OLD.control_sequence + 1 THEN
        applied_control_code := CASE
            WHEN OLD.delivery_status = 'pending' AND NEW.delivery_status = 'paused' THEN 'pause'
            WHEN OLD.delivery_status = 'paused' AND NEW.delivery_status = 'pending' THEN 'resume'
            WHEN OLD.delivery_status = 'failed' AND NEW.delivery_status = 'dead_lettered' THEN 'dead_letter'
            ELSE NULL
        END;

        IF applied_control_code IS NULL THEN
            RAISE EXCEPTION 'plugin_delivery_attempt_control_transition_check'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'plugin_delivery_attempt_control_transition_check';
        END IF;

        INSERT INTO plugin_integration.plugin_delivery_attempt_control_record (
            authority_version,
            delivery_id,
            workspace_id,
            requested_by_user_id,
            control_sequence,
            control_code,
            delivery_status,
            occurred_at,
            next_attempt_at,
            terminal_at
        ) VALUES (
            'life-os.plugin-delivery-attempt-control.v1',
            NEW.delivery_id,
            NEW.workspace_id,
            NEW.requested_by_user_id,
            NEW.control_sequence,
            applied_control_code,
            NEW.delivery_status,
            NEW.updated_at,
            NEW.next_attempt_at,
            NEW.terminal_at
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER plugin_delivery_attempt_control_record_transition
AFTER UPDATE ON plugin_integration.plugin_delivery_attempt_record
FOR EACH ROW
EXECUTE FUNCTION plugin_integration.record_plugin_delivery_attempt_control();

CREATE OR REPLACE FUNCTION plugin_integration.reject_plugin_delivery_attempt_control_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'plugin delivery attempt controls are append-only'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER plugin_delivery_attempt_control_append_only
BEFORE UPDATE OR DELETE ON plugin_integration.plugin_delivery_attempt_control_record
FOR EACH ROW
EXECUTE FUNCTION plugin_integration.reject_plugin_delivery_attempt_control_mutation();

CREATE TRIGGER plugin_delivery_attempt_control_append_only_truncate
BEFORE TRUNCATE ON plugin_integration.plugin_delivery_attempt_control_record
FOR EACH STATEMENT
EXECUTE FUNCTION plugin_integration.reject_plugin_delivery_attempt_control_mutation();

COMMENT ON TABLE plugin_integration.plugin_delivery_attempt_control_record IS
    'Integration-owned append-only pause, resume and dead-letter evidence; provider payloads, credentials and outbound-network authority are not persisted here.';
