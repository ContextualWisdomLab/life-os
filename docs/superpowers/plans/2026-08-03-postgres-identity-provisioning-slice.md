# Atomic PostgreSQL Identity Provisioning Slice

**Goal:** Persist provider-neutral user, external identity, and personal workspace aggregates without duplicate accounts or orphan rows when first-login callbacks race across service replicas.

## Tasks

- [x] Make the identity repository contract compatible with asynchronous persistence.
- [x] Keep in-memory provisioning idempotent when first-sign-in calls race.
- [x] Load one complete user, external identity, and personal workspace aggregate with parameterized SQL.
- [x] Validate UUIDv4 identifiers, provider values, ownership links, workspace kind, required text, and timestamps before returning stored data.
- [x] Serialize provisioning by provider and provider subject with a transaction-scoped PostgreSQL advisory lock.
- [x] Recheck the external identity after acquiring the lock and return the transaction winner.
- [x] Insert the user, external identity, and personal workspace in one transaction.
- [x] Roll back all writes and release the connection on failure.
- [x] Enforce UUIDv4 identifiers for identity users, external identities, workspaces, sessions, and OAuth transactions.
- [x] Add unit tests for parameter binding, transaction sequencing, race resolution, malformed rows, rollback, and connection release.
- [x] Exercise idempotent account provisioning and UUID constraints against PostgreSQL in CI.
- [ ] Run CI, SAST, Security Scan, and review feedback; fix all actionable findings.

## Concurrency model

`PostgresIdentityRepository.save` opens a database transaction and acquires a transaction-scoped advisory lock derived from the normalized provider and provider subject. It then repeats the aggregate lookup inside the lock. A callback that lost the first-sign-in race returns the committed account instead of attempting another insert. A callback that owns the lock inserts all three records and commits them together.

The initial lookup performed by `IdentityService` remains an efficient fast path for established accounts. Correctness does not depend on that lookup because the repository rechecks under the lock before writing.

## Deployment guidance

Migration `0005_opaque_uuid_v4_identifiers.sql` adds check constraints to existing UUID columns. Deployments containing legacy non-v4 identifiers must remediate those records before applying the migration. Current LifeOS domain services generate UUIDv4 identifiers, so environments created from the published migrations should apply the constraint without data changes.

Production wiring should pass a pooled PostgreSQL adapter whose `connect()` method returns a dedicated connection with `query()` and `release()` methods. The repository holds that connection only for the provisioning transaction and always releases it in a `finally` block.

## Verification boundary

Unit tests use recording SQL clients to verify that provider subjects and identifiers are supplied as bound parameters, that advisory locking precedes the in-transaction recheck, that duplicate provisioning returns the existing aggregate without inserts, and that failures trigger rollback and release. The PostgreSQL integration suite applies every migration in lexical order, provisions an account twice through the domain service, verifies one joined aggregate, and rejects a non-v4 UUID.
