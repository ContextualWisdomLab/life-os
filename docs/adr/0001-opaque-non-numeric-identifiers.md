# ADR 0001: Opaque UUIDv4 internal identifiers

**Status:** Accepted architecture  
**Date:** 2026-08-02

## Context

Sequential numeric identifiers expose cardinality/order and make authorization-locator enumeration easier. The original product exploration also proposed UUIDv7, which exposes temporal ordering. LifeOS is now a public multi-user server-backed product whose identifiers appear across APIs, events, logs, exports and persistence.

## Decision drivers

- opaque non-enumerable internal identity;
- consistent service/API/event representation;
- no reuse of external provider identifiers;
- tenant authorization independent from identifier knowledge;
- compatibility with PostgreSQL `uuid` and current source contracts.

## Alternatives considered

1. **Auto-increment integers:** rejected for enumeration/cardinality leakage and cross-service coupling pressure.
2. **UUIDv7:** rejected as the repository-wide internal invariant because time ordering is unnecessary and leaks creation ordering.
3. **Provider-native IDs:** rejected because providers can be numeric, mutable in semantics, or collide across providers.
4. **UUIDv4:** selected as the current protected-main contract.

## Decision

1. Internal entity identifiers use cryptographically random UUIDv4 values represented as strings in application code and PostgreSQL `uuid` in persistence.
2. Numeric primary keys, auto-increment columns, database sequences and numeric-only internal identifiers are prohibited for product-owned domain objects.
3. Third-party identifiers remain explicit provider metadata and map to independent LifeOS UUIDv4 IDs.
4. IDs are locators, never authorization evidence; all access remains actor/workspace scoped.
5. Public pagination uses opaque bounded cursors instead of exposing row offsets/primary keys where cursor pagination is implemented.

## Consequences

Indexes are larger and identifiers less human-readable than integers, but provider coupling and ordering leakage are reduced. Tests must validate UUIDv4 at trust boundaries and continue tenant authorization independently.

## Failure and recovery

Malformed or non-v4 identifiers fail before persistence access where the shared invariant applies. Existing invalid data requires an explicit migration rather than runtime coercion. Provider IDs are never silently converted into internal IDs.

## Security and privacy impact

Opaque UUIDs reduce enumeration/order leakage but do not replace authorization. Logs and exported references remain potentially sensitive tenant metadata and follow normal retention/access controls.

## Acceptance evidence

Protected-main `AGENTS.md`, service validators, migrations and integration tests require/use UUIDv4 internal identifiers. RFC 9562 defines UUID version 4 representation/semantics; the choice of v4 over v7 is a LifeOS architecture decision.

## Migration and rollback

The earlier UUIDv7 proposal was never the protected-main invariant. New code uses UUIDv4. Any future identifier-version migration requires versioned API/data migration and cannot reinterpret existing IDs in place.

## Supersession

This ADR supersedes the original UUIDv7 design language. It may be superseded only by a reviewed repository-wide identifier ADR with compatibility, privacy, migration and authorization evidence.