-- OAuth transactions are short-lived and cannot be safely assigned an encryption
-- key version retroactively. Invalidate any in-flight authorization attempts
-- before making key metadata mandatory.
DELETE FROM identity.oauth_transactions;

ALTER TABLE identity.oauth_transactions
  ADD COLUMN code_verifier_key_version text NOT NULL,
  ADD COLUMN nonce_key_version text,
  ADD CONSTRAINT oauth_verifier_key_version_format CHECK (
    code_verifier_key_version ~ '^[A-Za-z0-9._-]{1,64}$'
  ),
  ADD CONSTRAINT oauth_nonce_key_version_format CHECK (
    nonce_key_version IS NULL OR nonce_key_version ~ '^[A-Za-z0-9._-]{1,64}$'
  ),
  ADD CONSTRAINT oauth_verifier_ciphertext_minimum_length CHECK (
    octet_length(code_verifier_ciphertext) >= 28
  ),
  ADD CONSTRAINT oauth_nonce_ciphertext_minimum_length CHECK (
    nonce_ciphertext IS NULL OR octet_length(nonce_ciphertext) >= 28
  ),
  ADD CONSTRAINT oauth_nonce_encryption_metadata_by_provider CHECK (
    (
      provider = 'google'
      AND nonce_ciphertext IS NOT NULL
      AND nonce_key_version IS NOT NULL
    )
    OR (
      provider = 'github'
      AND nonce_ciphertext IS NULL
      AND nonce_key_version IS NULL
    )
  );
