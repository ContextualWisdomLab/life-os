CREATE SCHEMA IF NOT EXISTS notification_service;

CREATE TABLE IF NOT EXISTS notification_service.reminder_occurrences (
  reminder_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  reminder_title text NOT NULL,
  due_instant timestamptz NOT NULL,
  time_zone text NOT NULL,
  quiet_start_minute smallint,
  quiet_end_minute smallint,
  daily_delivery_limit smallint NOT NULL,
  delivery_attempt_count smallint NOT NULL DEFAULT 0,
  occurrence_status text NOT NULL DEFAULT 'pending',
  claim_key_hash bytea,
  claim_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT reminder_occurrences_primary_key PRIMARY KEY (reminder_id),
  CONSTRAINT reminder_occurrences_workspace_reminder_unique
    UNIQUE (workspace_id, reminder_id),
  CONSTRAINT reminder_occurrences_id_uuid_v4 CHECK (
    get_byte(uuid_send(reminder_id), 6) >> 4 = 4
    AND get_byte(uuid_send(reminder_id), 8) >> 6 = 2
  ),
  CONSTRAINT reminder_occurrences_workspace_uuid_v4 CHECK (
    get_byte(uuid_send(workspace_id), 6) >> 4 = 4
    AND get_byte(uuid_send(workspace_id), 8) >> 6 = 2
  ),
  CONSTRAINT reminder_occurrences_title_bounds CHECK (
    char_length(reminder_title) BETWEEN 1 AND 160
    AND octet_length(reminder_title) <= 1024
    AND reminder_title = btrim(reminder_title)
    AND reminder_title !~ '[[:cntrl:]]'
  ),
  CONSTRAINT reminder_occurrences_timezone_bounds CHECK (
    char_length(time_zone) BETWEEN 1 AND 64
    AND octet_length(time_zone) <= 256
    AND time_zone = btrim(time_zone)
    AND time_zone !~ '[[:cntrl:]]'
  ),
  CONSTRAINT reminder_occurrences_quiet_pair CHECK (
    (quiet_start_minute IS NULL AND quiet_end_minute IS NULL)
    OR (
      quiet_start_minute BETWEEN 0 AND 1439
      AND quiet_end_minute BETWEEN 0 AND 1439
      AND quiet_start_minute <> quiet_end_minute
    )
  ),
  CONSTRAINT reminder_occurrences_daily_limit CHECK (
    daily_delivery_limit BETWEEN 1 AND 20
  ),
  CONSTRAINT reminder_occurrences_attempt_limit CHECK (
    delivery_attempt_count BETWEEN 0 AND 3
  ),
  CONSTRAINT reminder_occurrences_status_values CHECK (
    occurrence_status IN ('pending', 'delivered', 'failed')
  ),
  CONSTRAINT reminder_occurrences_claim_pair CHECK (
    (claim_key_hash IS NULL AND claim_expires_at IS NULL)
    OR (
      claim_key_hash IS NOT NULL
      AND claim_expires_at IS NOT NULL
      AND octet_length(claim_key_hash) = 32
    )
  ),
  CONSTRAINT reminder_occurrences_terminal_claim CHECK (
    occurrence_status = 'pending'
    OR (claim_key_hash IS NOT NULL AND claim_expires_at IS NOT NULL)
  ),
  CONSTRAINT reminder_occurrences_timestamp_order CHECK (
    updated_at >= created_at
  )
);

CREATE INDEX IF NOT EXISTS reminder_occurrences_due_index
  ON notification_service.reminder_occurrences (
    due_instant ASC,
    reminder_id ASC
  )
  WHERE occurrence_status = 'pending';

CREATE INDEX IF NOT EXISTS reminder_occurrences_claim_expiry_index
  ON notification_service.reminder_occurrences (
    claim_expires_at ASC,
    workspace_id ASC,
    reminder_id ASC
  )
  WHERE occurrence_status = 'pending' AND claim_key_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS reminder_occurrences_workspace_index
  ON notification_service.reminder_occurrences (
    workspace_id,
    created_at DESC,
    reminder_id ASC
  );

CREATE TABLE IF NOT EXISTS notification_service.reminder_outcomes (
  outcome_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  reminder_id uuid NOT NULL,
  outcome_kind text NOT NULL,
  occurred_at timestamptz NOT NULL,
  next_attempt_at timestamptz,
  outcome_reason text,
  idempotency_key_hash bytea NOT NULL,
  delivery_local_date date,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT reminder_outcomes_primary_key PRIMARY KEY (outcome_id),
  CONSTRAINT reminder_outcomes_id_uuid_v4 CHECK (
    get_byte(uuid_send(outcome_id), 6) >> 4 = 4
    AND get_byte(uuid_send(outcome_id), 8) >> 6 = 2
  ),
  CONSTRAINT reminder_outcomes_workspace_uuid_v4 CHECK (
    get_byte(uuid_send(workspace_id), 6) >> 4 = 4
    AND get_byte(uuid_send(workspace_id), 8) >> 6 = 2
  ),
  CONSTRAINT reminder_outcomes_reminder_uuid_v4 CHECK (
    get_byte(uuid_send(reminder_id), 6) >> 4 = 4
    AND get_byte(uuid_send(reminder_id), 8) >> 6 = 2
  ),
  CONSTRAINT reminder_outcomes_kind_values CHECK (
    outcome_kind IN ('delivered', 'deferred', 'failed')
  ),
  CONSTRAINT reminder_outcomes_reason_values CHECK (
    outcome_reason IS NULL
    OR outcome_reason IN (
      'quiet_hours',
      'daily_limit',
      'delivery_failed',
      'attempt_limit'
    )
  ),
  CONSTRAINT reminder_outcomes_hash_length CHECK (
    octet_length(idempotency_key_hash) = 32
  ),
  CONSTRAINT reminder_outcomes_state_consistency CHECK (
    (
      outcome_kind = 'delivered'
      AND outcome_reason IS NULL
      AND next_attempt_at IS NULL
      AND delivery_local_date IS NOT NULL
    )
    OR (
      outcome_kind = 'deferred'
      AND outcome_reason IN ('quiet_hours', 'daily_limit')
      AND next_attempt_at IS NOT NULL
      AND delivery_local_date IS NULL
    )
    OR (
      outcome_kind = 'failed'
      AND delivery_local_date IS NULL
      AND (
        (
          outcome_reason = 'delivery_failed'
          AND next_attempt_at IS NOT NULL
        )
        OR (
          outcome_reason = 'attempt_limit'
          AND next_attempt_at IS NULL
        )
      )
    )
  ),
  CONSTRAINT reminder_outcomes_occurrence_foreign_key
    FOREIGN KEY (workspace_id, reminder_id)
    REFERENCES notification_service.reminder_occurrences (workspace_id, reminder_id)
    ON DELETE RESTRICT,
  CONSTRAINT reminder_outcomes_idempotency_unique
    UNIQUE (workspace_id, idempotency_key_hash, outcome_kind)
);

CREATE INDEX IF NOT EXISTS reminder_outcomes_workspace_index
  ON notification_service.reminder_outcomes (
    workspace_id,
    occurred_at DESC,
    outcome_id ASC
  );

CREATE INDEX IF NOT EXISTS reminder_outcomes_delivery_date_index
  ON notification_service.reminder_outcomes (
    workspace_id,
    delivery_local_date
  )
  WHERE outcome_kind = 'delivered';

CREATE TABLE IF NOT EXISTS notification_service.inbox_messages (
  message_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  reminder_id uuid NOT NULL,
  message_title text NOT NULL,
  due_instant timestamptz NOT NULL,
  time_zone text NOT NULL,
  idempotency_key_hash bytea NOT NULL,
  delivered_at timestamptz NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT inbox_messages_primary_key PRIMARY KEY (message_id),
  CONSTRAINT inbox_messages_id_uuid_v4 CHECK (
    get_byte(uuid_send(message_id), 6) >> 4 = 4
    AND get_byte(uuid_send(message_id), 8) >> 6 = 2
  ),
  CONSTRAINT inbox_messages_workspace_uuid_v4 CHECK (
    get_byte(uuid_send(workspace_id), 6) >> 4 = 4
    AND get_byte(uuid_send(workspace_id), 8) >> 6 = 2
  ),
  CONSTRAINT inbox_messages_reminder_uuid_v4 CHECK (
    get_byte(uuid_send(reminder_id), 6) >> 4 = 4
    AND get_byte(uuid_send(reminder_id), 8) >> 6 = 2
  ),
  CONSTRAINT inbox_messages_title_bounds CHECK (
    char_length(message_title) BETWEEN 1 AND 160
    AND octet_length(message_title) <= 1024
    AND message_title = btrim(message_title)
    AND message_title !~ '[[:cntrl:]]'
  ),
  CONSTRAINT inbox_messages_timezone_bounds CHECK (
    char_length(time_zone) BETWEEN 1 AND 64
    AND octet_length(time_zone) <= 256
    AND time_zone = btrim(time_zone)
    AND time_zone !~ '[[:cntrl:]]'
  ),
  CONSTRAINT inbox_messages_hash_length CHECK (
    octet_length(idempotency_key_hash) = 32
  ),
  CONSTRAINT inbox_messages_read_order CHECK (
    read_at IS NULL OR read_at >= delivered_at
  ),
  CONSTRAINT inbox_messages_timestamp_order CHECK (
    updated_at >= created_at
  ),
  CONSTRAINT inbox_messages_occurrence_foreign_key
    FOREIGN KEY (workspace_id, reminder_id)
    REFERENCES notification_service.reminder_occurrences (workspace_id, reminder_id)
    ON DELETE RESTRICT,
  CONSTRAINT inbox_messages_idempotency_unique
    UNIQUE (workspace_id, idempotency_key_hash)
);

CREATE INDEX IF NOT EXISTS inbox_messages_workspace_index
  ON notification_service.inbox_messages (
    workspace_id,
    delivered_at DESC,
    message_id ASC
  );

CREATE OR REPLACE FUNCTION notification_service.reject_reminder_outcome_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'reminder outcomes are immutable'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS reminder_outcomes_row_mutation_guard
  ON notification_service.reminder_outcomes;
CREATE TRIGGER reminder_outcomes_row_mutation_guard
BEFORE UPDATE OR DELETE ON notification_service.reminder_outcomes
FOR EACH ROW
EXECUTE FUNCTION notification_service.reject_reminder_outcome_mutation();

DROP TRIGGER IF EXISTS reminder_outcomes_truncate_guard
  ON notification_service.reminder_outcomes;
CREATE TRIGGER reminder_outcomes_truncate_guard
BEFORE TRUNCATE ON notification_service.reminder_outcomes
FOR EACH STATEMENT
EXECUTE FUNCTION notification_service.reject_reminder_outcome_mutation();
