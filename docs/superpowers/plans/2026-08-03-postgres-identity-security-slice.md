# Encrypted PostgreSQL Identity Security Slice

**Goal:** Persist OAuth authorization transactions and workspace-scoped sessions without storing reusable raw credentials.

## Tasks

- [x] Encrypt PKCE verifiers and Google OIDC nonces with AES-256-GCM.
- [x] Bind ciphertext authentication to the transaction ID and secret purpose.
- [x] Store an explicit key version for rotation and historical decryption.
- [x] Consume OAuth transactions atomically with one `UPDATE ... RETURNING` statement.
- [x] Use parameterized SQL for every secret, hash, identifier, and timestamp.
- [x] Persist and retrieve workspace-scoped sessions.
- [x] Revoke sessions idempotently without disclosing unknown token hashes.
- [x] Add cleanup operations for expired, consumed, and revoked records.
- [x] Add a forward migration for mandatory encryption-key metadata.
- [x] Apply all identity migrations and exercise the adapters against PostgreSQL in CI.
- [ ] Run CI, SAST, Security Scan, and review feedback; fix all actionable findings.

## Deployment guidance

Migration `0004_oauth_secret_key_versions.sql` intentionally deletes active OAuth transactions before adding mandatory key-version columns. Authorization transactions are short-lived and contain ciphertext whose historical key version cannot be inferred safely. Deployments must therefore expect users with an in-flight sign-in to restart authentication after this migration.

Application configuration must provide at least one 32-byte encryption key and identify the current version. Previous keys remain configured for decryption until all records written with those versions have expired and been removed. Key material must come from secret management and must never be committed to the repository.

The PostgreSQL client passed to these adapters must preserve parameter binding and return `bytea` columns as `Buffer` values. Production callback orchestration must await the atomic transaction-consumption operation before exchanging an authorization code.

## Verification boundary

Unit tests use a recording SQL client to verify parameterization, atomic SQL shape, encryption, decryption, cleanup, and row mapping. CI also starts a disposable PostgreSQL service, applies every identity migration in lexical order, and verifies encrypted OAuth transaction consumption, hashed session persistence and rotation, and the composite user/workspace tenant boundary against the real database engine.
