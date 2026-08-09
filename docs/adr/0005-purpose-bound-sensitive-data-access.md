# ADR-0005: Purpose-bound sensitive-data access

**Status:** Accepted  
**Date:** 2026-08-09

## Context

LifeOS may contain highly sensitive personal information. Blanket masking alone can destroy product utility while still failing to define who may access unmasked data, for what purpose, for how long, and with what audit evidence.

## Drivers

- useful user-controlled personal data;
- least privilege and tenant separation;
- explicit purpose limitation;
- short-lived/single-use privileged access;
- auditable decisions without copying sensitive payloads into logs;
- fail-closed authorization and replay behavior.

## Alternatives

1. Mask all sensitive values globally.
2. Rely only on broad service/account roles.
3. Authorize exact actor/resource/purpose combinations and issue bounded auditable grants where privileged access is required.

## Decision

Sensitive-data access uses purpose-bound authorization in addition to authentication and workspace ownership. Privacy-service records append-only decisions/events and, where needed, time-bounded/single-use grants. Encryption and secret-management boundaries protect stored/transport credentials; public logs/errors/artifacts remain content-minimized.

Masking/redaction is used where disclosure is unnecessary, not as a substitute for authorization.

## Consequences

- Privileged flows require explicit purpose/resource policy and evidence.
- Audit facts are retained separately from the sensitive payload whenever possible.
- Product/reporting features can still operate on authorized data rather than degraded masked substitutes.

## Failure/recovery

Expired, reused, malformed, wrong-purpose, wrong-actor or wrong-resource grants fail closed. Partial persistence failures roll back/compensate according to the privacy repository contract and never claim access was consumed successfully without durable evidence.

## Security/privacy impact

This is a primary privacy/security control. It reduces standing privilege and creates evidence for misuse investigation while minimizing sensitive logging.

## Acceptance evidence

Protected-main purpose-bound privacy service, signed context/grant tests, PostgreSQL integration tests and append-only mutation constraints merged in PR #124.

## Migration/rollback

New sensitive domains map operations to explicit purpose codes and policy before enabling privileged access. Disabling a purpose/grant path must not delete historical decision/event evidence.

## Supersession

Requires an access-control model that provides at least equivalent tenant, purpose, lifetime, replay, audit and recovery guarantees.
