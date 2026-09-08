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

COMMENT ON TABLE plugin_integration.plugin_delivery_attempt_record IS
    'Integration-owned durable delivery-attempt admission, claim/lease, retry scheduling and bounded exhaustion record; raw claim tokens, provider payloads, credentials and outbound-network authority are not persisted here.';
