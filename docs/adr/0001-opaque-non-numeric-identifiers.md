# ADR 0001: Opaque non-numeric identifiers

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

Sequential numeric identifiers expose record counts, creation order, and easily enumerable resource locators. They also encourage accidental trust in client-supplied IDs and make insecure direct object reference attacks easier to probe.

LifeOS is a public multi-user service, so identifiers visible in APIs, events, URLs, logs, exports, and database relationships must not reveal sequence or cardinality.

## Decision

1. Internal entity identifiers use cryptographically random UUIDv4 values represented as strings in application code and as PostgreSQL `uuid` columns in persistence.
2. Numeric primary keys, auto-increment columns, database sequences, and numeric-only public identifiers are prohibited.
3. Workspace, user, session, goal, project, task, habit, review, event, correlation, causation, export-job, and integration identifiers follow the same rule.
4. Client-supplied identifiers are validated as non-empty, non-numeric opaque strings before repository access.
5. Third-party identifiers are never reused as LifeOS primary keys. Provider identity is stored separately as `(provider, provider_subject)` text and mapped to an independent LifeOS UUIDv4 user ID.
6. OAuth provider subjects that happen to be numeric, such as some GitHub account IDs, remain external attributes only and are never exposed as internal resource IDs.
7. Public pagination uses opaque signed or encrypted cursors rather than offsets or row IDs.
8. IDs are authorization locators, not authorization evidence. Every lookup remains workspace- and actor-scoped.

## Why UUIDv4

UUIDv4 is preferred over sequential integers and time-ordered identifiers because it does not reveal creation time or ordering through the identifier itself. The collision probability is negligible for this system when generated with a cryptographically secure source.

## Consequences

- Database indexes are larger than integer indexes.
- Logs and URLs are less human-readable.
- Tests must verify generated IDs are UUIDv4 and reject numeric-only supplied identifiers.
- Foreign keys remain explicit and tenant-aware; opaque IDs do not replace authorization or tenant isolation.
- The earlier design note proposing UUIDv7 is superseded by this ADR.

## References

Davis, K. R., Peabody, B. G., & Leach, P. J. (2024). *Universally unique IDentifiers (UUIDs)* (RFC 9562) [Published Standards Track RFC]. RFC Editor. https://doi.org/10.17487/RFC9562

OWASP Foundation. (n.d.). *Insecure direct object reference (IDOR)*. https://owasp.org/www-community/attacks/insecure_direct_object_reference

OWASP Foundation. (2021). *A01:2021 – Broken access control*. https://owasp.org/Top10/2021/A01_2021-Broken_Access_Control/index.html
