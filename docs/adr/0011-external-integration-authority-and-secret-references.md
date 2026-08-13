# ADR 0011: External integration authority and secret references

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context

LifeOS integrates with external calendar providers and versioned plugins. Both domains need enough metadata and authority evidence to operate without turning external credentials or untrusted requested capabilities into ambient authority.

Protected #150 introduced a workspace-and-user-scoped calendar connection registry, protected #151 introduced tenant-scoped plugin installation grants, protected #153 added atomic calendar connection revocation, and active #155 adds a distinct signed workspace+user context for hosted calendar operations. Parent gaps #129 and #130 remain incomplete, so these bounded foundations must not be confused with complete provider/plugin runtime lifecycles.

## Decision drivers

- least privilege and explicit tenant/user authority;
- separation of internal identity, external metadata and secret material;
- no authority escalation from provider/plugin input;
- revocation and replay safety;
- service-owned persistence and no cross-service table mutation;
- truthful protected-vs-active maturity;
- replaceable managed secret/KMS and outbound-delivery adapters.

## Considered alternatives

1. **Persist provider credential plaintext in integration metadata rows.** Rejected: metadata and secrets have different access, rotation, retention and audit boundaries.
2. **Treat a plugin manifest's requested capabilities as grants.** Rejected: untrusted extension metadata cannot self-authorize host operations.
3. **Reuse provider account IDs as LifeOS identity/primary keys.** Rejected: external identifiers are mappings, not internal authority.
4. **Use LifeOS-owned UUIDv4 integration identity, separate secret references and explicit host-granted authority.** Selected.

## Decision

1. LifeOS-owned integration records use opaque UUIDv4 identity and are scoped by authenticated workspace and, where personal, owning user.
2. Provider/account/calendar/plugin identifiers remain bounded metadata and never replace LifeOS internal identity.
3. Persistent integration metadata may reference credential material only through an opaque secret handle or equivalent least-authority secret-store reference. The metadata row is not a credential store.
4. A plugin manifest expresses requested intent. The host grants an explicit capability subset; requested-but-ungranted capabilities have no authority.
5. Exact replay may return the same result only when authority-relevant evidence matches; conflicting identity reuse fails closed.
6. Revocation ends future active local authority while retaining bounded audit/reconciliation evidence. Local record revocation is not automatically provider-side OAuth revocation or secret destruction.
7. User-sensitive internal calendar operations require authority that binds both workspace and requesting user; workspace-only context remains a distinct sync contract.
8. Outbound delivery, provider refresh/revoke, managed secret storage, discovery and related runtime features are separately gated and cannot be inferred from the existence of an integration record or grant.
9. Every owning service retains migration/repository/API authority. Cross-service relationships use versioned contracts rather than direct table access.

## Consequences

- Calendar metadata and plugin authority can evolve independently from managed secret backends.
- Product code requires exact tenant/actor scoped lookups instead of identifier-only retrieval.
- A stored integration record or grant does not prove the full provider/plugin runtime is production complete.
- Secret-store/KMS and delivery adapters can change without changing internal integration identity when contracts remain compatible.

## Failure and recovery

Malformed authority, identifier substitution, stale/future signed context, revoked integration identity, capability escalation, incompatible replay and corrupted persistence fail closed. Secret-store/provider failure never widens authority. Recovery requires a newly authorized operation or bounded operator repair preserving audit/reconciliation evidence; editing another service's tables is not recovery.

## Security and privacy impact

The model reduces standing credential exposure and prevents untrusted metadata from self-authorizing. Tenant/user scope, revocation, least privilege and secret separation remain explicit. Provider identifiers/secret references are not authentication evidence for unrelated LifeOS domains.

## Acceptance evidence

- Protected #139: signed trusted workspace calendar context.
- Protected #150 (`1623df364925f84920c07c112f1ae96777277d20`): workspace+user calendar connection persistence with bounded metadata and opaque secret references.
- Protected #151 (`6971c4e11b3204ec41526c7c959a248e54440e1c`): explicit plugin capability grants, replay/conflict isolation and revocation semantics.
- Protected #153 (`b13413e571bad82535f63d478e40746d12c3e680`): atomic tenant+user calendar connection revocation.
- Active #155: distinct short-lived signed workspace+user calendar context; not protected-main evidence before merge.
- Parent #129/#130 remain incomplete until full credential/runtime delivery acceptance criteria are satisfied.

## Migration and rollback

Introduce opaque internal IDs/secret references before removing legacy development configuration. Rollback may disable an integration path but must not reintroduce client-selected tenant authority, plaintext credential persistence as a general contract, implicit plugin grants, provider-native primary-key authority or workspace-only authorization for user-sensitive operations.

## Supersession

A later ADR may replace this model only with equal-or-stronger separation of internal identity, external metadata, secret material and granted authority, plus explicit migration/rollback and protected-main acceptance evidence.
