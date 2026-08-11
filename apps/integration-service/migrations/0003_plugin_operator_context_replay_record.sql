CREATE TABLE plugin_integration.plugin_operator_context_replay_record (
    evidence_sha256 text PRIMARY KEY,
    consumed_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    CONSTRAINT plugin_operator_context_evidence_sha256_format_check
        CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT plugin_operator_context_replay_lifetime_check
        CHECK (expires_at >= consumed_at)
);

CREATE INDEX plugin_operator_context_replay_expiry_index
    ON plugin_integration.plugin_operator_context_replay_record (expires_at);
