# Guided review migrations

Apply SQL files in lexical order to the PostgreSQL database owned by the Review service before starting a new application version.

- `0001_guided_review_completions.sql` creates the `guided_review.review_completions` append-only evidence table. It enforces UUIDv4 identifiers, supported ritual kinds, Monday-anchored weekly periods, complete step counts, bounded evidence and reflection fields, canonical SHA-256 digests, one completion per workspace/ritual/period, and one immutable command per workspace/idempotency key.

## Runtime configuration

The service requires `REVIEW_DATABASE_URL` with a `postgres:` or `postgresql:` scheme. Optional pool settings are `REVIEW_DATABASE_POOL_MAX` (`1`–`32`, default `10`), `REVIEW_DATABASE_CONNECT_TIMEOUT_MS` (`100`–`30000`, default `5000`), and `REVIEW_DATABASE_IDLE_TIMEOUT_MS` (`1000`–`300000`, default `30000`). Credentials belong in the deployment secret store and must never be committed, logged, or returned in HTTP failures.

The application does not apply migrations during startup. Deployment automation must apply every migration exactly once before shifting traffic, then start the service with a database role limited to the `guided_review` schema.

## Rollback

Migrations are forward-only in automated environments. An operator-approved rollback of `0001` must first export review evidence and verify retention obligations, then drop the `guided_review` schema. Review completions are immutable audit evidence and must not be silently deleted as part of an application rollback.
