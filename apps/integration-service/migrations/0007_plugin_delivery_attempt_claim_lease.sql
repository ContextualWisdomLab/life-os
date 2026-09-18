ALTER TABLE plugin_integration.plugin_delivery_attempt_record
    ADD COLUMN claim_token_digest text,
    ADD COLUMN claim_started_at timestamptz,
    ADD COLUMN claim_expires_at timestamptz;

ALTER TABLE plugin_integration.plugin_delivery_attempt_record
    DROP CONSTRAINT plugin_delivery_attempt_count_check;

ALTER TABLE plugin_integration.plugin_delivery_attempt_record
    ADD CONSTRAINT plugin_delivery_attempt_count_check
        CHECK (attempt_count BETWEEN 0 AND max_attempts),
    ADD CONSTRAINT plugin_delivery_attempt_claim_digest_check
        CHECK (
            claim_token_digest IS NULL
            OR claim_token_digest ~ '^[0-9a-f]{64}$'
        ),
    ADD CONSTRAINT plugin_delivery_attempt_claim_shape_check
        CHECK (
            (
                attempt_count = 0
                AND claim_token_digest IS NULL
                AND claim_started_at IS NULL
                AND claim_expires_at IS NULL
            )
            OR
            (
                attempt_count >= 1
                AND claim_token_digest IS NOT NULL
                AND claim_started_at IS NOT NULL
                AND claim_expires_at IS NOT NULL
            )
        ),
    ADD CONSTRAINT plugin_delivery_attempt_claim_time_check
        CHECK (
            claim_started_at IS NULL
            OR (
                claim_started_at >= requested_at
                AND claim_expires_at >= claim_started_at + INTERVAL '30 seconds'
                AND claim_expires_at <= claim_started_at + INTERVAL '3600 seconds'
                AND updated_at >= claim_started_at
            )
        );

COMMENT ON TABLE plugin_integration.plugin_delivery_attempt_record IS
    'Integration-owned durable delivery-attempt admission and claim/lease record; insertion requires active origin/installation authority and worker leases retain only a SHA-256 token digest.';

CREATE INDEX plugin_delivery_attempt_claimable_schedule_index
    ON plugin_integration.plugin_delivery_attempt_record (
        next_attempt_at,
        claim_expires_at,
        delivery_id
    )
    WHERE delivery_status = 'pending';
