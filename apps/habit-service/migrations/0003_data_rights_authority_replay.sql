BEGIN;

CREATE TABLE habit.data_rights_authority_replay_records (
  evidence_digest text NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT data_rights_authority_replay_records_primary
    PRIMARY KEY (evidence_digest),
  CONSTRAINT data_rights_authority_replay_records_digest_sha256 CHECK (
    evidence_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT data_rights_authority_replay_records_expiry_order CHECK (
    expires_at >= consumed_at
  )
);

CREATE INDEX data_rights_authority_replay_expiry_index
  ON habit.data_rights_authority_replay_records (expires_at);

COMMENT ON TABLE habit.data_rights_authority_replay_records IS
  'Habit-owned one-time evidence for destructive data-rights HTTP authority.';
COMMENT ON COLUMN habit.data_rights_authority_replay_records.evidence_digest IS
  'SHA-256 digest of one canonical validated HMAC proof; raw authorization evidence is never persisted.';
COMMENT ON COLUMN habit.data_rights_authority_replay_records.consumed_at IS
  'Database-clock instant at which the winning Habit service instance consumed the destructive authority.';
COMMENT ON COLUMN habit.data_rights_authority_replay_records.expires_at IS
  'End of the signed authority lifetime after which the replay record can be pruned.';

COMMIT;
