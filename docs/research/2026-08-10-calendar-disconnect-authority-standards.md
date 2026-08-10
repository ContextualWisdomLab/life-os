# Calendar connection disconnect authority — standards traceability

## Status

**Implemented on active PR**

This record supports the bounded local-disconnect slice on PR #157. It does not claim the complete OAuth/KMS credential lifecycle in issue #129.

## Applied decisions

- A browser-supplied connection identifier is only an object locator. Workspace and requesting-user ownership are derived from the short-lived signed `life-os.calendar-user.v1` service context before the application is invoked.
- Persistence receives the exact `(connection_id, workspace_id, user_id)` authority tuple and returns only credential-free revocation evidence.
- Missing or differently owned records are indistinguishable at the public boundary.
- Provider access/refresh credentials are neither read nor returned by the local-disconnect operation. Provider-side OAuth revocation and secret deletion remain later #129 work.
- The public result is deliberately bounded to connection identity, local revoked status, and server-generated revocation time.
- Model execution is not involved in authentication, authorization, revocation, or error classification.

These are LifeOS design choices informed by least-privilege, separation-of-authority, auditability, and current OAuth security practice; they are not claims of formal NIST or OAuth conformance.

## Current authoritative sources

RFC 9700 is the current OAuth 2.0 Security Best Current Practice (BCP 240), published in January 2025. It updates OAuth security guidance and deprecates modes now considered insecure. The complete #129 OAuth/PKCE/refresh/revocation flow must continue to follow this BCP rather than treating the existing browser-login credential path as calendar authorization.

NIST SP 800-53 Rev. 5 is a final publication with Access Control, Identification and Authentication, Audit and Accountability, and related security/privacy control families. LifeOS applies these principles by preserving explicit authenticated authority, least privilege, bounded public evidence, and audit-friendly local lifecycle state without asserting certification.

The local PostgreSQL revocation primitive remains one conditional tenant/user-scoped state transition. Any future multi-step provider/KMS + local-database disconnect operation must preserve explicit partial-failure and recovery evidence rather than reporting an all-or-nothing success that did not occur.

## APA 7 references

Lodderstedt, T., Bradley, J., Labunets, A., & Fett, D. (2025). *Best current practice for OAuth 2.0 security* (RFC 9700; BCP 240) [Published Best Current Practice]. RFC Editor. https://doi.org/10.17487/RFC9700

Joint Task Force. (2020). *Security and privacy controls for information systems and organizations* (NIST Special Publication 800-53 Rev. 5) [Final publication]. National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-53r5
