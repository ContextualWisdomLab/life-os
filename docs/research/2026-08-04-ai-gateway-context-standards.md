# AI gateway context standards research

## Research question

Which current, authoritative standards support a short-lived HMAC-SHA-256 service context that derives tenant and actor scope from an authenticated server-side session, binds authorization evidence to an exact HTTP method and path, and returns bounded credential-free API failures?

## Findings and implementation consequences

### Message authentication

RFC 2104 defines HMAC as keyed message authentication over a shared secret. RFC 4231 supplies independently cross-verified HMAC-SHA-256 vectors suitable for conformance testing. NIST FIPS 198-1 remains the published final U.S. HMAC standard as of August 4, 2026. NIST announced a proposed withdrawal in June 2025 so that maintained guidance can move to SP 800-224; SP 800-224 is still an Initial Public Draft and is therefore recorded as transition guidance rather than represented as a final standard.

LifeOS consequently uses the complete 32-byte HMAC-SHA-256 output, rejects secrets shorter than 32 UTF-8 bytes, caps secret input at 4096 bytes, performs strict canonical base64url decoding, and compares fixed-length digest bytes in constant time. The signature authenticates the trusted proxy workload; it does not replace browser-session authentication or workspace authorization.

### HTTP request binding

RFC 9110 defines HTTP method semantics and the request target. A service credential that does not bind these dimensions could be replayed from a read operation to a state-changing decision endpoint. LifeOS therefore signs the exact uppercase method and canonical AI-service path in addition to workspace, actor, and issuance time. The verifier rejects unsupported methods, noncanonical paths, path or method replay, stale contexts older than 60 seconds, and contexts more than five seconds in the future.

### Server-side authorization

OWASP Application Security Verification Standard 5.0.0 is the latest stable ASVS release. Its server-side access-control principles support deriving authorization scope from trusted server-side state rather than request-controlled tenant or actor fields. LifeOS sends the opaque browser cookie only to identity-service session introspection, derives `workspaceId` and `userId` from the validated session response, and never forwards the cookie, bearer material, `x-workspace-id`, or `x-actor-id` to AI service.

### Problem details and disclosure control

RFC 9457 defines machine-readable HTTP problem details and warns against exposing implementation or sensitive information in errors. LifeOS returns fixed `about:blank` problem objects with stable status, title, and code values. It does not return exception text, cookies, secrets, origin credentials, model content, database details, or dependency responses except for three explicitly reconstructed tenant-safe 404/409 conditions.

## Applicability boundary

This design is appropriate for a private BFF-to-service hop where both workloads can securely receive one shared secret. It does not provide end-user nonrepudiation, compromise containment between multiple signers sharing the same key, or zero-downtime multi-key rotation. Asymmetric workload identity, service-mesh authentication, multiple active verification keys, and fine-grained action authorization require separate reviewed slices.

## APA 7 references

Fielding, R., Nottingham, M., & Reschke, J. (2022). _HTTP semantics_ (RFC 9110). RFC Editor. https://doi.org/10.17487/RFC9110

Krawczyk, H., Bellare, M., & Canetti, R. (1997). _HMAC: Keyed-hashing for message authentication_ (RFC 2104). RFC Editor. https://doi.org/10.17487/RFC2104

National Institute of Standards and Technology. (2008). _The keyed-hash message authentication code (HMAC)_ (FIPS PUB 198-1). U.S. Department of Commerce. https://doi.org/10.6028/NIST.FIPS.198-1

National Institute of Standards and Technology. (2025, June 23). _Proposed withdrawal of FIPS 198-1, keyed-hash message authentication code (HMAC)._ https://csrc.nist.gov/news/2025/proposed-withdrawal-of-fips-198-1-hmac

Nottingham, M., Wilde, E., & Dalal, S. (2023). _Problem details for HTTP APIs_ (RFC 9457). RFC Editor. https://doi.org/10.17487/RFC9457

Nystrom, M. (2005). _Identifiers and test vectors for HMAC-SHA-224, HMAC-SHA-256, HMAC-SHA-384, and HMAC-SHA-512_ (RFC 4231). RFC Editor. https://doi.org/10.17487/RFC4231

OWASP Foundation. (2025). _OWASP application security verification standard 5.0.0._ https://github.com/OWASP/ASVS/releases/tag/v5.0.0_release

Turan, M. S., & Brandão, L. T. A. N. (2024). _Keyed-hash message authentication code (HMAC): Specification of HMAC and recommendations for message authentication_ (NIST SP 800-224 Initial Public Draft). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-224.ipd
