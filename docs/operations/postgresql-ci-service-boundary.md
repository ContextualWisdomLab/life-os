# PostgreSQL CI service boundary

LifeOS CI uses PostgreSQL as an ephemeral service boundary for database-backed acceptance tests. The service image and bootstrap authentication are part of the reviewed test environment rather than ambient runner defaults.

## Decision

The affected hosted CI and scheduled conformance/development workflows use the Docker Official PostgreSQL `16.15-bookworm` image pinned by digest:

`sha256:bb3e1a57e5407e0a5280b4211980a5e537f4abd234a87014ac979849a78dd825`

Initialization sets both `POSTGRES_HOST_AUTH_METHOD=scram-sha-256` and `POSTGRES_INITDB_ARGS=--auth-local=scram-sha-256 --auth-host=scram-sha-256`. Database clients continue to use the service-owned `postgres` test credential. The health probe remains `pg_isready`, while application acceptance uses authenticated PostgreSQL connections.

## Evidence and rationale

The previous pinned Alpine service emitted `sh: locale: not found`, `WARNING: no usable system locales were found`, and `initdb: warning: enabling "trust" authentication for local connections` on hosted Ubuntu runners. A hosted candidate probe against the pinned Bookworm image verified both explicit SCRAM/SCRAM and peer/SCRAM profiles without those warnings and with an authenticated TCP query succeeding. LifeOS selected SCRAM for both local and host bootstrap paths so the policy is explicit and credential-bound instead of relying on operating-system user identity inside the service container.

The Debian variant was selected over adding Alpine locale packages at runtime. Runtime package installation would make CI initialization depend on an additional mutable network/package-manager step and would not address the implicit authentication policy by itself. Warning filtering was rejected because it would hide the control failure rather than remove it.

PostgreSQL `initdb` defines `--auth-local` and `--auth-host` as the bootstrap controls for `pg_hba.conf`. The Docker Official Image passes `POSTGRES_INITDB_ARGS` through to `initdb`; `POSTGRES_HOST_AUTH_METHOD` remains explicit so the container entrypoint and generated host rule agree on SCRAM.

## Verification and rollback

A change to this boundary must prove all of the following on one exact candidate head:

- every owned PostgreSQL service block uses the reviewed immutable image and explicit authentication settings;
- initialization logs contain none of `no usable system locales were found`, `enabling "trust" authentication`, or `sh: locale: not found`;
- a password-authenticated TCP query succeeds;
- PostgreSQL-backed LifeOS acceptance remains GREEN.

Rollback means reverting the complete image/authentication change together. Do not retain the Debian image while silently restoring implicit authentication, and do not suppress initialization diagnostics.

## References

- PostgreSQL Global Development Group. (2026). *PostgreSQL 16: initdb*. https://www.postgresql.org/docs/16/app-initdb.html
- Docker, Inc. (2026). *Postgres Official Image*. https://hub.docker.com/_/postgres
