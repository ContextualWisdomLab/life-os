ALTER TABLE plugin_integration.plugin_delivery_attempt_record
    ALTER COLUMN next_attempt_at DROP NOT NULL,
    DROP CONSTRAINT plugin_delivery_attempt_status_check,
    DROP CONSTRAINT plugin_delivery_attempt_time_check,
    DROP CONSTRAINT plugin_delivery_attempt_outcome_check,
    DROP CONSTRAINT plugin_delivery_attempt_claim_shape_check;

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
                delivery_status = 'failed'
                AND attempt_count = max_attempts
                AND next_attempt_at IS NULL
                AND terminal_at = updated_at
                AND last_outcome_code = 'attempt_limit'
                AND claim_token_digest IS NULL
                AND claim_started_at IS NULL
                AND claim_expires_at IS NULL
            )
        ),
    ADD CONSTRAINT plugin_delivery_attempt_lifecycle_time_check
        CHECK (
            updated_at >= requested_at
            AND (
                next_attempt_at IS NULL
                OR next_attempt_at >= requested_at
            )
            AND (
                terminal_at IS NULL
                OR terminal_at >= requested_at
            )
        );

CREATE OR REPLACE FUNCTION plugin_integration.require_plugin_delivery_attempt_initial_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.delivery_status <> 'pending'
       OR NEW.attempt_count <> 0
       OR NEW.next_attempt_at IS NULL
       OR NEW.terminal_at IS NOT NULL
       OR NEW.last_outcome_code IS NOT NULL
       OR NEW.claim_token_digest IS NOT NULL
       OR NEW.claim_started_at IS NOT NULL
       OR NEW.claim_expires_at IS NOT NULL THEN
        RAISE EXCEPTION 'plugin_delivery_attempt_initial_shape_check'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'plugin_delivery_attempt_initial_shape_check';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS plugin_delivery_attempt_initial_shape
    ON plugin_integration.plugin_delivery_attempt_record;

CREATE TRIGGER plugin_delivery_attempt_initial_shape
BEFORE INSERT ON plugin_integration.plugin_delivery_attempt_record
FOR EACH ROW
EXECUTE FUNCTION plugin_integration.require_plugin_delivery_attempt_initial_shape();

COMMENT ON TABLE plugin_integration.plugin_delivery_attempt_record IS
    'Integration-owned durable delivery-attempt admission, claim/lease, retry scheduling and bounded exhaustion record; direct creation is restricted to the initial admission shape and raw claim tokens, provider payloads, credentials and outbound-network authority are not persisted here.';
