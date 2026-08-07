BEGIN;

CREATE SCHEMA IF NOT EXISTS privacy_access;

CREATE TABLE IF NOT EXISTS privacy_access.privacy_access_decisions (
  decision_id uuid PRIMARY KEY,
  grant_id uuid UNIQUE,
  workspace_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  purpose_code text NOT NULL,
  action_code text NOT NULL,
  resource_category text NOT NULL,
  access_mode text NOT NULL,
  decision_outcome text NOT NULL,
  policy_revision_id uuid NOT NULL,
  policy_digest char(64) NOT NULL,
  request_digest char(64) NOT NULL,
  reason_digest char(64) NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT privacy_decision_id_version_check CHECK (
    substring(decision_id::text from 15 for 1) = '4'
    AND substring(decision_id::text from 20 for 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT privacy_decision_grant_version_check CHECK (
    grant_id IS NULL OR (
      substring(grant_id::text from 15 for 1) = '4'
      AND substring(grant_id::text from 20 for 1) IN ('8', '9', 'a', 'b')
    )
  ),
  CONSTRAINT privacy_decision_workspace_version_check CHECK (
    substring(workspace_id::text from 15 for 1) = '4'
    AND substring(workspace_id::text from 20 for 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT privacy_decision_actor_version_check CHECK (
    substring(actor_id::text from 15 for 1) = '4'
    AND substring(actor_id::text from 20 for 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT privacy_decision_policy_version_check CHECK (
    substring(policy_revision_id::text from 15 for 1) = '4'
    AND substring(policy_revision_id::text from 20 for 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT privacy_decision_purpose_check CHECK (
    purpose_code IN (
      'workspace_operation',
      'account_support',
      'security_investigation',
      'data_subject_request',
      'legal_obligation',
      'break_glass'
    )
  ),
  CONSTRAINT privacy_decision_action_check CHECK (
    action_code IN ('read', 'export', 'correct', 'administer')
  ),
  CONSTRAINT privacy_decision_resource_check CHECK (
    resource_category IN (
      'identity_profile',
      'planning_content',
      'habit_content',
      'review_content',
      'calendar_content',
      'notification_content',
      'ai_audit_content'
    )
  ),
  CONSTRAINT privacy_decision_mode_check CHECK (
    access_mode IN ('ordinary', 'break_glass')
  ),
  CONSTRAINT privacy_decision_outcome_check CHECK (
    decision_outcome IN ('allowed', 'denied')
  ),
  CONSTRAINT privacy_decision_policy_digest_check CHECK (
    policy_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT privacy_decision_request_digest_check CHECK (
    request_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT privacy_decision_reason_digest_check CHECK (
    reason_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT privacy_decision_grant_shape_check CHECK (
    (
      decision_outcome = 'allowed'
      AND grant_id IS NOT NULL
      AND expires_at IS NOT NULL
      AND expires_at > issued_at
    ) OR (
      decision_outcome = 'denied'
      AND grant_id IS NULL
      AND expires_at IS NULL
    )
  ),
  CONSTRAINT privacy_decision_mode_purpose_check CHECK (
    (access_mode = 'break_glass') = (purpose_code = 'break_glass')
  )
);

CREATE TABLE IF NOT EXISTS privacy_access.privacy_access_grants (
  grant_id uuid PRIMARY KEY,
  decision_id uuid NOT NULL UNIQUE,
  workspace_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  token_digest char(64) NOT NULL UNIQUE,
  policy_revision_id uuid NOT NULL,
  policy_digest char(64) NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_event_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT privacy_grant_decision_foreign_key FOREIGN KEY (decision_id)
    REFERENCES privacy_access.privacy_access_decisions(decision_id),
  CONSTRAINT privacy_grant_id_version_check CHECK (
    substring(grant_id::text from 15 for 1) = '4'
    AND substring(grant_id::text from 20 for 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT privacy_grant_decision_version_check CHECK (
    substring(decision_id::text from 15 for 1) = '4'
    AND substring(decision_id::text from 20 for 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT privacy_grant_workspace_version_check CHECK (
    substring(workspace_id::text from 15 for 1) = '4'
    AND substring(workspace_id::text from 20 for 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT privacy_grant_actor_version_check CHECK (
    substring(actor_id::text from 15 for 1) = '4'
    AND substring(actor_id::text from 20 for 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT privacy_grant_token_digest_check CHECK (
    token_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT privacy_grant_policy_digest_check CHECK (
    policy_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT privacy_grant_expiry_check CHECK (expires_at > issued_at),
  CONSTRAINT privacy_grant_consumption_shape_check CHECK (
    (consumed_at IS NULL AND consumed_event_id IS NULL)
    OR (consumed_at IS NOT NULL AND consumed_event_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS privacy_access.privacy_access_events (
  access_event_id uuid PRIMARY KEY,
  grant_id uuid NOT NULL UNIQUE,
  decision_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  purpose_code text NOT NULL,
  action_code text NOT NULL,
  resource_category text NOT NULL,
  access_mode text NOT NULL,
  policy_revision_id uuid NOT NULL,
  policy_digest char(64) NOT NULL,
  resource_reference_digest char(64) NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT privacy_event_grant_foreign_key FOREIGN KEY (grant_id)
    REFERENCES privacy_access.privacy_access_grants(grant_id),
  CONSTRAINT privacy_event_decision_foreign_key FOREIGN KEY (decision_id)
    REFERENCES privacy_access.privacy_access_decisions(decision_id),
  CONSTRAINT privacy_event_id_version_check CHECK (
    substring(access_event_id::text from 15 for 1) = '4'
    AND substring(access_event_id::text from 20 for 1) IN ('8', '9', 'a', 'b')
  ),
  CONSTRAINT privacy_event_resource_digest_check CHECK (
    resource_reference_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT privacy_event_policy_digest_check CHECK (
    policy_digest ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS privacy_decision_workspace_time_index
  ON privacy_access.privacy_access_decisions (
    workspace_id,
    issued_at DESC,
    decision_id
  );

CREATE INDEX IF NOT EXISTS privacy_decision_actor_time_index
  ON privacy_access.privacy_access_decisions (
    workspace_id,
    actor_id,
    issued_at DESC,
    decision_id
  );

CREATE INDEX IF NOT EXISTS privacy_grant_consumption_index
  ON privacy_access.privacy_access_grants (
    workspace_id,
    actor_id,
    expires_at,
    consumed_at
  );

CREATE INDEX IF NOT EXISTS privacy_event_workspace_time_index
  ON privacy_access.privacy_access_events (
    workspace_id,
    occurred_at DESC,
    access_event_id
  );

CREATE OR REPLACE FUNCTION privacy_access.reject_privacy_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'privacy access evidence is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION privacy_access.restrict_privacy_grant_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'privacy access grants cannot be deleted';
  END IF;

  IF OLD.consumed_at IS NOT NULL
    OR NEW.consumed_at IS NULL
    OR NEW.consumed_event_id IS NULL
    OR OLD.grant_id IS DISTINCT FROM NEW.grant_id
    OR OLD.decision_id IS DISTINCT FROM NEW.decision_id
    OR OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
    OR OLD.actor_id IS DISTINCT FROM NEW.actor_id
    OR OLD.token_digest IS DISTINCT FROM NEW.token_digest
    OR OLD.policy_revision_id IS DISTINCT FROM NEW.policy_revision_id
    OR OLD.policy_digest IS DISTINCT FROM NEW.policy_digest
    OR OLD.issued_at IS DISTINCT FROM NEW.issued_at
    OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'privacy access grant mutation is invalid';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS privacy_decision_update_rejection
  ON privacy_access.privacy_access_decisions;
CREATE TRIGGER privacy_decision_update_rejection
BEFORE UPDATE OR DELETE ON privacy_access.privacy_access_decisions
FOR EACH ROW EXECUTE FUNCTION privacy_access.reject_privacy_evidence_mutation();

DROP TRIGGER IF EXISTS privacy_event_update_rejection
  ON privacy_access.privacy_access_events;
CREATE TRIGGER privacy_event_update_rejection
BEFORE UPDATE OR DELETE ON privacy_access.privacy_access_events
FOR EACH ROW EXECUTE FUNCTION privacy_access.reject_privacy_evidence_mutation();

DROP TRIGGER IF EXISTS privacy_grant_mutation_restriction
  ON privacy_access.privacy_access_grants;
CREATE TRIGGER privacy_grant_mutation_restriction
BEFORE UPDATE OR DELETE ON privacy_access.privacy_access_grants
FOR EACH ROW EXECUTE FUNCTION privacy_access.restrict_privacy_grant_mutation();

COMMIT;
