# ADR-0002: Opaque UUIDv4 internal identifiers

**Status:** Accepted  
**Date:** 2026-08-09

## Context

The original 2026-08-02 combined design proposed UUIDv7 identifiers. Protected-main `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, migrations and regression tests now establish opaque UUIDv4 internal identifiers and reject sequential/non-v4 values in security-sensitive domains. Provider-native numeric identifiers must not become LifeOS primary keys.

Leaving UUIDv7 in an apparently authoritative design creates contradictory schema and API guidance.

## Drivers

- one repository-wide identifier invariant;
- opacity across tenant and provider boundaries;
- resistance to accidental exposure of provider identity/order;
- compatibility with existing protected-main migrations/tests;
- no numeric internal primary keys.

## Alternatives

1. Keep UUIDv7 from the historical design.
2. Use mixed UUID versions by service.
3. Standardize current internal IDs on UUIDv4 and treat external IDs as provider metadata.

## Decision

All new LifeOS internal object identifiers use **UUIDv4** unless a separately reviewed external protocol requires another identifier form at its boundary. Numeric provider IDs and external resource IDs are mapped through explicit provider records and never reused as internal primary keys.

The historical UUIDv7 statement is superseded.

## Consequences

- APIs/database migrations/tests share one current identifier contract.
- Chronological ordering must use explicit timestamp/revision fields rather than ID ordering.
- Existing UUIDv4 rows need no migration.
- External sortable IDs remain an adapter concern, not an internal schema shortcut.

## Failure and recovery

Malformed, non-v4, sequential or provider-native identifiers at internal boundaries fail closed before ownership-sensitive operations. Public errors do not echo sensitive rows or credentials.

## Security/privacy impact

Opaque IDs reduce information leakage and make provider-identity confusion less likely, but UUIDs are not authorization. Every operation still enforces authenticated workspace/resource authority.

## Acceptance evidence

- `AGENTS.md` UUIDv4 invariant;
- `CLAUDE.md` UUIDv4 invariant;
- root `ARCHITECTURE.md` UUIDv4 invariant;
- protected-main tests/migrations rejecting non-v4 identifiers in relevant services.

## Migration / rollback

No migration is required for the accepted protected-main baseline. A future change to another UUID version requires explicit cross-service migration and API compatibility evidence; it must not reinterpret existing UUIDv4 rows.

## Supersession

Supersede only through an ADR that proves product benefit, cross-service migration safety, tenant/security effects, indexing/performance effects and backwards compatibility.
