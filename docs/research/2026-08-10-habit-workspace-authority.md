# Habit workspace authority hardening — standards traceability

## Status

**Implemented on active PR**

This note records the standards basis for issue #161. It does not claim formal NIST conformance or complete end-user gateway composition.

## Decision

Every workspace-scoped Habit route verifies the same short-lived `life-os.workspace.v1` service context used by Planning. The browser-visible workspace identifier participates in an HMAC-protected gateway assertion; it is not independently sufficient authorization. The Habit domain and PostgreSQL repository continue to enforce workspace ownership, so gateway verification and service-level tenant predicates remain separate defense-in-depth controls.

The current public gateway still exposes only its historical placeholder Today composition and does not yet proxy the Habit HTTP API. Therefore this slice hardens the independently deployable Habit service boundary without claiming that hosted browser-to-Habit composition is complete. A later gateway/product slice must derive the workspace from the authenticated session, mint this context, and forward no browser credential to Habit.

## Security rationale

NIST SP 800-53 Rev. 5 separates identification/authentication from access control and includes least-privilege, authorized-access and auditability principles. LifeOS applies those principles by establishing tenant authority before Habit domain access, retaining tenant predicates in persistence, exposing credential-free problem details, and keeping model execution outside the authorization path.

No LLM, agent, manifest or request body can grant Habit workspace authority. Model/provider availability cannot convert an invalid signed context into an authorized request.

## APA 7 reference

Joint Task Force. (2020). *Security and privacy controls for information systems and organizations* (NIST Special Publication 800-53 Rev. 5) [Final publication]. National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-53r5
