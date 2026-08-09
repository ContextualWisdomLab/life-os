# ADR 0001: Opaque non-numeric identifiers

**Status:** Superseded  
**Date:** 2026-08-02

## Context

Sequential numeric identifiers expose record counts, creation order, and easily enumerable resource locators. They also encourage accidental trust in client-supplied IDs and make insecure direct object reference attacks easier to probe.

LifeOS is a public multi-user service, so identifiers visible in APIs, events, URLs, logs, exports, and database relationships must not reveal sequence or cardinality.

## Drivers

- avoid sequential/enumerable internal identifiers;
- keep third-party provider identifiers outside LifeOS primary-key authority;
- retain tenant-scoped authorization independently from locator opacity;
- use a repository-wide identifier contract that tests and migrations can enforce.

## Alternatives

1. Sequential database-generated integer identifiers.
2. Time-ordered UUID variants.
3. Cryptographically random UUIDv4 identifiers with explicit provider mappings.

## Decision

1. Internal entity identifiers use cryptographically random UUIDv4 values represented as strings in application code and as PostgreSQL `uuid` columns in persistence.
2. Numeric primary keys, auto-increment columns, database sequences, and numeric-only public identifiers are prohibited.
3. Workspace, user, session, goal, project, task, habit, review, event, correlation, causation, export-job, and integration identifiers follow the same rule.
4. Client-supplied identifiers are validated before repository access.
5. Third-party identifiers are never reused as LifeOS primary keys. Provider identity is stored separately and mapped to an independent LifeOS UUIDv4 identifier.
6. IDs are authorization locators, not authorization evidence. Every lookup remains workspace- and actor-scoped.

## Consequences

- Database indexes are larger than integer indexes.
- Logs and URLs are less human-readable.
- Tests verify generated IDs are UUIDv4 and reject numeric/sequential supplied identifiers at protected boundaries.
- Foreign keys remain explicit and tenant-aware; opaque IDs do not replace authorization or tenant isolation.
- Chronological ordering uses explicit temporal/revision fields instead of identifier order.

## Failure and recovery

Malformed or nonconforming internal identifiers fail closed before ownership-sensitive repository operations. Existing valid UUIDv4 identifiers require no data migration.

## Security and privacy impact

Opaque identifiers reduce enumeration and provider-identity leakage, but do not weaken the requirement for authenticated, tenant-scoped authorization.

## Acceptance evidence

This historical decision is reflected by protected-main UUIDv4 validators, migrations, security tests, and repository-wide agent/architecture contracts. ADR-0002 restates the same current invariant in the canonical documentation graph with explicit migration and supersession guidance.

## Migration / rollback

No data migration is required by this record because the protected-main data model already uses UUIDv4. Any future identifier-version change requires a separately reviewed compatibility and migration decision.

## Supersession

**Superseded by ADR-0002, `Opaque UUIDv4 internal identifiers`.** ADR-0002 is the canonical current formulation; this file is retained because ADR identifiers and historical rationale must not disappear when the documentation graph is consolidated.
