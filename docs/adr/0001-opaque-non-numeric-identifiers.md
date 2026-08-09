# ADR 0001: Opaque UUIDv4 internal identifiers

**Status:** Accepted architecture  
**Date:** 2026-08-02

## Context

Sequential numeric identifiers expose record counts/order and make enumerable resource locators easier to probe. Earlier LifeOS design material also proposed UUIDv7. The protected-main product instead requires identifiers that do not expose creation time/order and that remain independent from provider-native IDs.

## Decision drivers

- multi-user tenant isolation;
- non-enumerable opaque locators;
- no provider-ID coupling;
- consistent API/event/database identity semantics;
- current protected-main migration/test compatibility.

## Considered alternatives

1. **Auto-increment integers** — rejected because they expose sequence/cardinality and encourage unsafe public locators.
2. **UUIDv7** — rejected for the current product because time ordering is encoded in the identifier and the protected-main contract already standardizes UUIDv4.
3. **Provider-native IDs** — rejected as internal authority because providers have different formats/lifecycles and some IDs are numeric.
4. **UUIDv4** — selected.

## Decision

1. Internal durable entity identifiers use cryptographically random UUIDv4 values represented as strings in application code and PostgreSQL `uuid` columns where persisted.
2. Numeric primary keys, auto-increment sequences and numeric-only public/internal entity IDs are prohibited for product-owned entities.
3. Third-party identifiers remain explicit provider metadata/mappings and never become LifeOS primary keys.
4. IDs are locators, not authorization evidence; every lookup remains actor/workspace scoped.
5. Public pagination uses opaque cursor semantics rather than exposing row offsets/primary keys where pagination is required.

## Consequences

- indexes are larger than integer indexes;
- logs/URLs are less human-readable;
- UUID version/shape requires deterministic validation tests;
- opaque IDs do not remove the need for tenant authorization;
- external-provider migrations remain decoupled from LifeOS primary identity.

## Failure and recovery

Malformed/non-v4 internal IDs fail validation before repository access where the domain requires this invariant. A future identifier change requires an explicit migration and dual-read/write or other compatibility strategy; it cannot be introduced by silently accepting a second format.

## Security and privacy impact

UUIDv4 reduces enumeration/order disclosure but does not prevent IDOR by itself. Tenant-derived authorization remains mandatory. Provider numeric IDs are not exposed as internal resource identity merely because they are available at login.

## Acceptance evidence

Protected-main architecture, validators, migrations and tests use opaque UUIDv4 internal IDs. New product-owned schemas/tests must preserve this invariant.

## Migration and rollback

The earlier UUIDv7 proposal is documentation-only historical material and requires no data rollback. Any future production identifier migration requires its own ADR, schema plan and compatibility evidence.

## Supersession

This ADR supersedes earlier UUIDv7 design language for LifeOS internal identifiers. It remains authoritative until a later accepted ADR and protected-main migration/test evidence explicitly replace it.