BEGIN;

CREATE SCHEMA IF NOT EXISTS ai;

CREATE TABLE ai.proposal_audit_records (
  proposal_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  model_id text NOT NULL,
  request_json jsonb NOT NULL,
  request_digest text NOT NULL,
  summary text NOT NULL,
  rationale_json jsonb NOT NULL,
  operations_json jsonb NOT NULL,
  requires_confirmation boolean NOT NULL,
  content_digest text NOT NULL,
  created_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT proposal_audit_records_identity_unique
    UNIQUE (proposal_id, workspace_id, content_digest),
  CONSTRAINT proposal_audit_records_proposal_id_uuid_v4 CHECK (
    proposal_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT proposal_audit_records_workspace_id_uuid_v4 CHECK (
    workspace_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT proposal_audit_records_model_id_nonblank CHECK (
    length(btrim(model_id)) BETWEEN 1 AND 200
  ),
  CONSTRAINT proposal_audit_records_request_object CHECK (
    jsonb_typeof(request_json) = 'object'
  ),
  CONSTRAINT proposal_audit_records_request_digest_sha256 CHECK (
    request_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT proposal_audit_records_summary_nonblank CHECK (
    length(btrim(summary)) BETWEEN 1 AND 1000
  ),
  CONSTRAINT proposal_audit_records_rationale_array CHECK (
    jsonb_typeof(rationale_json) = 'array'
    AND jsonb_array_length(rationale_json) BETWEEN 1 AND 20
  ),
  CONSTRAINT proposal_audit_records_operations_array CHECK (
    jsonb_typeof(operations_json) = 'array'
    AND jsonb_array_length(operations_json) BETWEEN 1 AND 20
  ),
  CONSTRAINT proposal_audit_records_confirmation_required CHECK (
    requires_confirmation IS TRUE
  ),
  CONSTRAINT proposal_audit_records_content_digest_sha256 CHECK (
    content_digest ~ '^[0-9a-f]{64}$'
  )
);

CREATE TABLE ai.proposal_decision_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  proposal_content_digest text NOT NULL,
  actor_id uuid NOT NULL,
  decision_kind text NOT NULL,
  reason_text text,
  idempotency_key uuid NOT NULL,
  decided_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT proposal_decision_events_id_workspace_unique
    UNIQUE (id, workspace_id),
  CONSTRAINT proposal_decision_events_idempotency_unique
    UNIQUE (workspace_id, proposal_id, idempotency_key),
  CONSTRAINT proposal_decision_events_proposal_digest_foreign
    FOREIGN KEY (proposal_id, workspace_id, proposal_content_digest)
    REFERENCES ai.proposal_audit_records (
      proposal_id,
      workspace_id,
      content_digest
    ),
  CONSTRAINT proposal_decision_events_id_uuid_v4 CHECK (
    id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT proposal_decision_events_workspace_id_uuid_v4 CHECK (
    workspace_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT proposal_decision_events_proposal_id_uuid_v4 CHECK (
    proposal_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT proposal_decision_events_actor_id_uuid_v4 CHECK (
    actor_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT proposal_decision_events_idempotency_key_uuid_v4 CHECK (
    idempotency_key::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT proposal_decision_events_content_digest_sha256 CHECK (
    proposal_content_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT proposal_decision_events_kind_valid CHECK (
    decision_kind IN ('accepted', 'rejected')
  ),
  CONSTRAINT proposal_decision_events_reason_bounded CHECK (
    reason_text IS NULL
    OR length(btrim(reason_text)) BETWEEN 1 AND 1000
  )
);

CREATE INDEX proposal_audit_records_workspace_creation_idx
  ON ai.proposal_audit_records (
    workspace_id,
    created_at ASC,
    proposal_id ASC
  );

CREATE INDEX proposal_decision_events_workspace_proposal_recorded_idx
  ON ai.proposal_decision_events (
    workspace_id,
    proposal_id,
    recorded_at ASC,
    id ASC
  );

CREATE FUNCTION ai.reject_proposal_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'AI proposal audit history is append-only';
END;
$$;

CREATE TRIGGER proposal_audit_records_append_only
BEFORE UPDATE OR DELETE ON ai.proposal_audit_records
FOR EACH ROW
EXECUTE FUNCTION ai.reject_proposal_audit_mutation();

CREATE TRIGGER proposal_audit_records_reject_truncate
BEFORE TRUNCATE ON ai.proposal_audit_records
FOR EACH STATEMENT
EXECUTE FUNCTION ai.reject_proposal_audit_mutation();

CREATE TRIGGER proposal_decision_events_append_only
BEFORE UPDATE OR DELETE ON ai.proposal_decision_events
FOR EACH ROW
EXECUTE FUNCTION ai.reject_proposal_audit_mutation();

CREATE TRIGGER proposal_decision_events_reject_truncate
BEFORE TRUNCATE ON ai.proposal_decision_events
FOR EACH STATEMENT
EXECUTE FUNCTION ai.reject_proposal_audit_mutation();

COMMIT;
