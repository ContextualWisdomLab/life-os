CREATE SCHEMA IF NOT EXISTS guided_review;

CREATE TABLE IF NOT EXISTS guided_review.review_completions (
  id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  ritual_kind TEXT NOT NULL,
  period_start_date DATE NOT NULL,
  idempotency_key UUID NOT NULL,
  completed_step_count INTEGER NOT NULL,
  total_step_count INTEGER NOT NULL,
  planned_item_count INTEGER NOT NULL,
  completed_item_count INTEGER NOT NULL,
  habit_completion_count INTEGER NOT NULL,
  reflection_text TEXT,
  completed_at TIMESTAMPTZ NOT NULL,
  payload_digest TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT review_completions_primary_key PRIMARY KEY (id),
  CONSTRAINT review_completions_id_uuid_v4 CHECK (
    id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT review_completions_workspace_uuid_v4 CHECK (
    workspace_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT review_completions_idempotency_uuid_v4 CHECK (
    idempotency_key::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT review_completions_ritual_kind_allowed CHECK (
    ritual_kind IN ('daily-planning', 'daily-shutdown', 'weekly-review')
  ),
  CONSTRAINT review_completions_weekly_monday CHECK (
    ritual_kind <> 'weekly-review'
    OR EXTRACT(ISODOW FROM period_start_date) = 1
  ),
  CONSTRAINT review_completions_step_counts_valid CHECK (
    total_step_count BETWEEN 1 AND 64
    AND completed_step_count = total_step_count
  ),
  CONSTRAINT review_completions_evidence_counts_valid CHECK (
    planned_item_count BETWEEN 0 AND 10000
    AND completed_item_count BETWEEN 0 AND planned_item_count
    AND habit_completion_count BETWEEN 0 AND 10000
  ),
  CONSTRAINT review_completions_reflection_length_valid CHECK (
    reflection_text IS NULL
    OR char_length(reflection_text) BETWEEN 1 AND 2000
  ),
  CONSTRAINT review_completions_payload_digest_valid CHECK (
    payload_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT review_completions_idempotency_unique UNIQUE (
    workspace_id,
    idempotency_key
  ),
  CONSTRAINT review_completions_period_unique UNIQUE (
    workspace_id,
    ritual_kind,
    period_start_date
  )
);

CREATE INDEX IF NOT EXISTS review_completions_history_order_idx
  ON guided_review.review_completions (
    workspace_id,
    completed_at DESC,
    recorded_at DESC,
    id DESC
  );
