# Planning workspace authority hardening — standards traceability

## Status

**Implemented on active PR**

This note records the standards basis for issue #158. It does not claim certification or formal NIST conformance.

## Decision

Goal, project and task create/list endpoints use the same short-lived signed `life-os.workspace.v1` gateway context already used by planning search and durable Today. The browser-visible workspace identifier is an input to a cryptographically verified service context, not a standalone authorization claim. A bare legacy `x-workspace-id` header no longer establishes tenant ownership.

The planning service continues to enforce workspace predicates in its domain/repository boundaries, so the signed gateway context is defense in depth rather than a replacement for tenant-scoped persistence.

## Security rationale

NIST SP 800-53 Rev. 5 separates identification/authentication from access-control enforcement and emphasizes least privilege, authorized access, auditability and protection against unauthorized use. LifeOS applies those principles by requiring the authenticated gateway boundary to establish workspace authority before the request reaches planning operations, while retaining workspace-scoped service and database checks.

No model or autonomous agent participates in planning authorization. Model availability and model judgments cannot turn an invalid workspace context into an authorized request.

## APA 7 reference

Joint Task Force. (2020). *Security and privacy controls for information systems and organizations* (NIST Special Publication 800-53 Rev. 5) [Final publication]. National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-53r5
