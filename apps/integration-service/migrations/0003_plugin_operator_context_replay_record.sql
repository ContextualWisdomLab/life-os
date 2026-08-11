CREATE TABLE plugin_integration.plugin_operator_context_replay_record (
    evidence_id uuid PRIMARY KEY,
    consumed_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    CONSTRAINT plugin_operator_context_replay_lifetime_check
        CHECK (expires_at >= consumed_at)
);

CREATE INDEX plugin_operator_context_replay_expiry_index
    ON plugin_integration.plugin_operator_context_replay_record (expires_at);

COMMENT ON TABLE plugin_integration.plugin_operator_context_replay_record IS
    'Durable one-time plugin operator evidence consumed by the Integration service to prevent replay across service instances.';
COMMENT ON COLUMN plugin_integration.plugin_operator_context_replay_record.evidence_id IS
    'Signed UUIDv4 evidence identity; primary-key uniqueness permits exactly one durable consumption.';
COMMENT ON COLUMN plugin_integration.plugin_operator_context_replay_record.consumed_at IS
    'Instant when the winning Integration service instance consumed the signed evidence.';
COMMENT ON COLUMN plugin_integration.plugin_operator_context_replay_record.expires_at IS
    'Retention deadline after which the evidence record is eligible for cleanup because its signature lifetime has closed.';
