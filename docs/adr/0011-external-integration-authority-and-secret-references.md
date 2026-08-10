# ADR 0011: External integration authority and secret references

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context

LifeOS integrates with external calendar providers and versioned plugins. Both domains need to persist or carry enough metadata to identify an external integration without turning external credentials or requested plugin capabilities into ambient authority.

Protected-main PR #150 introduced a workspace-and-user-scoped calendar connection registry and protected-main PR #151 introduced tenant-scoped plugin installation grants. The parent product gaps #129 and #130 remain incomplete, so this ADR defines the durable authority model without confusing those bounded foundations with complete provider/plugin runtime lifecycles.

## Decision drivers

- least privilege and explicit tenant/user authority;
- separation of identity metadata from secret material;
- no authority escalation from untrusted provider/plugin input;
- revocation and replay safety;
- service-owned persistence and no cross-service table mutation;
- clear active-versus-protected maturity;
- compatibility with future managed secret/KMS adapters and outbound delivery controls.

## Considered alternatives

1. **Persist external credential content directly in integration metadata rows.** Rejected because integration metadata and secret lifecycle have different access, rotation, retention and audit requirements.
2. **Treat a plugin manifest's requested capabilities as granted authority.** Rejected because untrusted extension metadata cannot self-authorize host operations.
3. **Reuse provider account identifiers as LifeOS identity or primary keys.** Rejected because external identifiers are mappings, not internal authority.
4. **Use LifeOS-owned opaque integration records plus separate secret references and explicit host-granted capability sets.** Selected.

## Decision

1. LifeOS-owned integration records use opaque UUIDv4 identity and are scoped by the authenticated workspace and, where the provider relationship is personal, the owning user.
2. External provider/account/calendar/plugin identifiers remain bounded metadata and never replace LifeOS internal identity.
3. Persistent integration metadata may reference credential material through an opaque secret handle or equivalent least-authority secret-store reference. The metadata record is not a credential store.
4. A plugin manifest expresses requested intent. The host grants an explicit capability subset; requested-but-ungranted capabilities have no authority.
5. Exact replay of an installation/connection command may return the same result only when authority-relevant evidence matches. Conflicting identity reuse fails closed.
6. Revocation prevents future active authority while retaining the bounded evidence needed for audit/reconciliation according to policy.
7. Outbound delivery, provider refresh, managed secret storage, discovery and other runtime capabilities remain separately gated and cannot be inferred from the existence of an integration record.
8. Every owning service keeps its migrations/repository/API authority. Cross-service relationships use versioned contracts rather than direct table access.

## Consequences

- Calendar connection metadata and plugin installation authority can evolve independently from managed secret backends.
- Product code needs explicit lookups scoped by tenant and relevant actor rather than identifier-only retrieval.
- A stored integration record is not evidence that the full provider/plugin runtime is production complete.
- Secret-store/KMS and delivery adapters can be replaced without changing internal integration identity if their versioned contracts remain compatible.

## Failure and recovery

Malformed authority, unknown/revoked integration identity, capability escalation, incompatible replay and corrupted duplicate persistence fail closed. Secret-store or provider failures do not widen local authority. Recovery requires a newly authorized operation or a bounded operator repair that preserves audit/reconciliation evidence; editing another service's tables is not a recovery mechanism.

## Security and privacy impact

The decision reduces standing credential exposure and prevents untrusted integration metadata from becoming self-authorizing. Tenant/user scope, purpose, revocation and least privilege remain explicit. External provider identifiers and secret references are not authentication evidence for unrelated LifeOS domains.

## Acceptance evidence

- Protected main PR #139: signed trusted calendar workspace context.
- Protected main PR #150 (`1623df364925f84920c07c112f1ae96777277d20`): calendar connection migration/repository scoped to workspace+user with bounded metadata and opaque secret references.
- Protected main PR #151 (`6971c4e11b3204ec41526c7c959a248e54440e1c`): explicit plugin capability grants, replay/conflict handling, tenant/user lookup isolation and revocation semantics.
- Parent gaps #129 and #130 remain incomplete until their full credential/runtime delivery acceptance criteria are satisfied on protected main.

## Migration and rollback

New integration persistence should introduce opaque internal IDs and secret references before removing legacy development configuration. Rollback may disable an integration path but must not reintroduce client-selected tenant authority, plaintext credential persistence as a general contract, implicit plugin capability grants or provider-native primary-key authority.

## Supersession

A later ADR may replace this model only with an equal-or-stronger separation of internal identity, external metadata, secret material and granted capability authority, plus an explicit migration/rollback path and protected-main acceptance evidence.
