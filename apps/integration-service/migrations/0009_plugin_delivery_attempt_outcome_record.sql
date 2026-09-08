CREATE TABLE IF NOT EXISTS plugin_integration.plugin_delivery_attempt_outcome_record (
  authority_version TEXT NOT NULL
    CHECK (authority_version = 'life-os.plugin-delivery-attempt-outcome.v1'),
  delivery_id UUID NOT NULL REFERENCES plugin_integration.plugin_delivery_attempt_record(delivery_id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 10),
  outcome_code TEXT NOT NULL
    CHECK (outcome_code IN ('retryable_failure', 'attempt_limit')),
  occurred_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (delivery_id, attempt_number)
);

CREATE OR REPLACE FUNCTION plugin_integration.record_plugin_delivery_attempt_outcome()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.claim_token_digest IS NOT NULL
     AND NEW.claim_token_digest IS NULL
     AND NEW.last_outcome_code IN ('retryable_failure', 'attempt_limit') THEN
    IF OLD.claim_started_at IS NULL
       OR OLD.claim_expires_at IS NULL
       OR NEW.attempt_count <> OLD.attempt_count
       OR NEW.updated_at < OLD.claim_started_at
       OR NEW.updated_at >= OLD.claim_expires_at THEN
      RAISE EXCEPTION 'plugin_delivery_attempt_outcome_claim_transition_check'
        USING ERRCODE = '23514',
              CONSTRAINT = 'plugin_delivery_attempt_outcome_claim_transition_check';
    END IF;

    INSERT INTO plugin_integration.plugin_delivery_attempt_outcome_record (
      authority_version,
      delivery_id,
      attempt_number,
      outcome_code,
      occurred_at
    ) VALUES (
      'life-os.plugin-delivery-attempt-outcome.v1',
      NEW.delivery_id,
      NEW.attempt_count,
      NEW.last_outcome_code,
      NEW.updated_at
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS plugin_delivery_attempt_outcome_record_transition
  ON plugin_integration.plugin_delivery_attempt_record;

CREATE TRIGGER plugin_delivery_attempt_outcome_record_transition
AFTER UPDATE ON plugin_integration.plugin_delivery_attempt_record
FOR EACH ROW
EXECUTE FUNCTION plugin_integration.record_plugin_delivery_attempt_outcome();

CREATE OR REPLACE FUNCTION plugin_integration.reject_plugin_delivery_attempt_outcome_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'plugin delivery attempt outcomes are append-only'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS plugin_delivery_attempt_outcome_append_only
  ON plugin_integration.plugin_delivery_attempt_outcome_record;

CREATE TRIGGER plugin_delivery_attempt_outcome_append_only
BEFORE UPDATE OR DELETE ON plugin_integration.plugin_delivery_attempt_outcome_record
FOR EACH ROW
EXECUTE FUNCTION plugin_integration.reject_plugin_delivery_attempt_outcome_mutation();
