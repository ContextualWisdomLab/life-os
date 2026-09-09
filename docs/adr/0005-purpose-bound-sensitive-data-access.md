# ADR 0005: Purpose-bound sensitive-data access

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context
LifeOS contains personal planning, identity and integration data. Blanket masking would destroy legitimate product workflows while unrestricted access would undermine privacy and auditability.

## Decision drivers
Business utility, tenant isolation, least privilege, controlled disclosure, auditability, retention, CSAP/SOC 2 evidence readiness without false certification claims.

## Alternatives considered
- blanket PII masking — rejected as primary control;
- broad authenticated access — rejected;
- tenant/resource/purpose/lifetime-scoped authorization with audit evidence — selected.

## Decision
Sensitive access requires authenticated actor/workspace authority plus bounded purpose/resource/lifetime rules. Grants are time-bounded/single-use where designed and access/decision evidence is append-only. Encryption/secret boundaries, least-privilege service roles and retention controls complement authorization.

## Consequences
Callers must carry explicit purpose/resource context and systems need auditable grant/decision lifecycle, but valid workflows retain usable data.

## Failure and recovery
Malformed/expired/replayed/cross-tenant grants fail closed. Provider or audit-store outage cannot be interpreted as authorization success.

## Security and privacy impact
Raw credentials, prompts/responses and unnecessary tenant content remain outside public artifacts/logs. Pseudonymous identifiers are still sensitive metadata and retain access/retention controls.

## Acceptance evidence
Protected-main privacy-service decisions/grants/events and exact-expiry/concurrency/immutability tests.

## Migration and rollback
New sensitive resources must be registered with explicit purpose/authority semantics before use. Rollback may disable a new access path but must preserve immutable historical audit evidence.

## Supersession
A future privacy model may supersede this only with equivalent or stronger tenant/purpose/audit evidence and a migration plan.