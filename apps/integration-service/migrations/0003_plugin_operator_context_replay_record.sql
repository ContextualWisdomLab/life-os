CREATE TABLE plugin_integration.plugin_operator_context_replay_record (
    evidence_id uuid PRIMARY KEY,
    consumed_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    CONSTRAINT plugin_operator_context_replay_lifetime_check
        CHECK (expires_at >= consumed_at)
);

CREATE INDEX plugin_operator_context_replay_expiry_index
    ON plugin_integration.plugin_operator_context_replay_record (expires_at);
