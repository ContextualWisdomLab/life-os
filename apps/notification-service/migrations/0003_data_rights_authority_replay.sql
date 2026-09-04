BEGIN;

CREATE TABLE notification_service.data_rights_authority_replay_records (
  evidence_digest text PRIMARY KEY,
  consumed_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT data_rights_authority_replay_digest_sha256 CHECK (
    evidence_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT data_rights_authority_replay_expiry_order CHECK (
    expires_at > consumed_at
  )
);

COMMENT ON TABLE notification_service.data_rights_authority_replay_records IS
  'Stores only SHA-256 digests of authenticated destructive data-rights authority so an erase signature can be consumed once across Notification service replicas. Raw signatures, verifier secrets, tenant identifiers, and user identifiers are deliberately excluded; rows expire at the signed authority lifetime boundary.';

COMMENT ON COLUMN notification_service.data_rights_authority_replay_records.evidence_digest IS
  'SHA-256 digest of one already-validated service HMAC signature; primary-key uniqueness is the cross-replica replay fence.';

COMMENT ON COLUMN notification_service.data_rights_authority_replay_records.consumed_at IS
  'Database-clock instant when the destructive authority first won durable consumption.';

COMMENT ON COLUMN notification_service.data_rights_authority_replay_records.expires_at IS
  'Database-comparable end of the signed service-authority lifetime; expired rows may be pruned by the Notification runtime.';

CREATE INDEX data_rights_authority_replay_expiry_index
  ON notification_service.data_rights_authority_replay_records (expires_at);

REVOKE ALL ON TABLE notification_service.data_rights_authority_replay_records
  FROM PUBLIC;

COMMIT;
