# ADR 0005: Purpose-bound sensitive-data access

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context

Personal productivity data can include health, relationship, career and other sensitive context. Blanket masking would destroy legitimate product value and is not a substitute for authorization. LifeOS needs a narrower authority model that records why an actor may access a sensitive resource.

## Decision drivers

- least privilege;
- meaningful product use without indiscriminate masking;
- tenant separation;
- auditable sensitive access;
- bounded grants and revocation/expiry.

## Considered alternatives

1. Mask all sensitive data everywhere — rejected as overbroad and incompatible with legitimate user-authorized product behavior.
2. Rely only on coarse workspace membership — rejected for sensitive-purpose decisions.
3. Purpose/resource/actor/lifetime-bound authorization with auditable evidence — selected.

## Decision

Sensitive-access decisions bind actor, workspace, resource/resource class, purpose and lifetime. Where designed, grants are bounded/single-use and fail closed at expiry. Decisions/grants/events are persisted as auditable evidence without turning logs/artifacts into copies of unnecessary sensitive content.

## Consequences

- product features needing sensitive context must declare a purpose;
- authorization tests become more detailed;
- access evidence may be retained longer than transient product content where policy requires it;
- masking remains a presentation/logging technique, not the core authorization model.

## Failure and recovery

Missing/malformed/expired/replayed/mismatched grants fail closed. Recovery requires a newly authorized decision rather than manually editing audit rows.

## Security and privacy impact

This model reduces broad standing privilege and supports post-event audit. Tenant scope and encryption/secret management still apply independently.

## Acceptance evidence

Protected main includes the privacy service, purpose-bound privacy access migration and security/integration tests.

## Migration and rollback

New sensitive capabilities must map existing coarse permissions into explicit purposes before removing legacy checks. Rollback may disable a feature but must not weaken existing audit/tenant enforcement.

## Supersession

This ADR remains authoritative until a later reviewed privacy-authority model replaces it with equivalent or stronger evidence.