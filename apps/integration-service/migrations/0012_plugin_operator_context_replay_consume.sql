CREATE OR REPLACE FUNCTION plugin_integration.consume_plugin_operator_context_replay(
    p_evidence_id uuid,
    p_consumed_at timestamptz,
    p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    consumed_evidence_id uuid;
BEGIN
    INSERT INTO plugin_integration.plugin_operator_context_replay_record (
        evidence_id,
        consumed_at,
        expires_at
    ) VALUES (
        p_evidence_id,
        p_consumed_at,
        p_expires_at
    )
    ON CONFLICT (evidence_id) DO UPDATE
    SET consumed_at = EXCLUDED.consumed_at,
        expires_at = EXCLUDED.expires_at
    WHERE plugin_integration.plugin_operator_context_replay_record.expires_at < now()
    RETURNING evidence_id INTO consumed_evidence_id;

    IF consumed_evidence_id IS NULL THEN
        RETURN false;
    END IF;

    DELETE FROM plugin_integration.plugin_operator_context_replay_record AS replay_record
    WHERE replay_record.evidence_id IN (
        SELECT expired_record.evidence_id
        FROM plugin_integration.plugin_operator_context_replay_record AS expired_record
        WHERE expired_record.expires_at < now()
          AND expired_record.evidence_id <> p_evidence_id
        ORDER BY expired_record.expires_at
        FOR UPDATE SKIP LOCKED
        LIMIT 32
    );

    RETURN true;
END;
$$;

COMMENT ON FUNCTION plugin_integration.consume_plugin_operator_context_replay(uuid, timestamptz, timestamptz) IS
    'Atomically consumes one Plugin operator evidence identity and performs bounded post-consume expiry cleanup in the same PostgreSQL round trip.';
