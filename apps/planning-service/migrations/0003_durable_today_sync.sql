CREATE TABLE planning.today_aggregates (
  workspace_id uuid NOT NULL,
  local_date date NOT NULL,
  aggregate_id uuid NOT NULL,
  revision_number bigint NOT NULL CHECK (revision_number >= 1),
  revision_token uuid NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT today_aggregates_pk PRIMARY KEY (workspace_id, local_date),
  CONSTRAINT today_aggregates_id_unique UNIQUE (aggregate_id),
  CONSTRAINT today_aggregates_uuidv4_check CHECK (
    workspace_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND aggregate_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND revision_token::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT today_aggregates_payload_check CHECK (
    jsonb_typeof(payload_json) = 'object'
    AND payload_json ->> 'version' = 'life-os.today.v1'
    AND payload_json ->> 'date' = local_date::text
    AND jsonb_typeof(payload_json -> 'actions') = 'array'
  )
);

CREATE TABLE planning.today_idempotency_records (
  workspace_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_digest text NOT NULL,
  result_kind text NOT NULL CHECK (result_kind IN ('created', 'updated')),
  aggregate_id uuid NOT NULL,
  revision_token uuid NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT today_idempotency_records_pk
    PRIMARY KEY (workspace_id, idempotency_key),
  CONSTRAINT today_idempotency_records_uuidv4_check CHECK (
    workspace_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND idempotency_key::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND aggregate_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND revision_token::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT today_idempotency_records_digest_check
    CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT today_idempotency_records_payload_check CHECK (
    jsonb_typeof(payload_json) = 'object'
    AND payload_json ->> 'version' = 'life-os.today.v1'
    AND jsonb_typeof(payload_json -> 'actions') = 'array'
  )
);

CREATE INDEX today_aggregates_workspace_updated_idx
  ON planning.today_aggregates (workspace_id, updated_at DESC);

CREATE INDEX today_idempotency_created_idx
  ON planning.today_idempotency_records (workspace_id, created_at DESC);
