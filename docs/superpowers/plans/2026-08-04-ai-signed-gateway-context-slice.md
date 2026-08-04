# AI signed gateway context slice

## Objective

Remove client-selectable tenant and actor authority from every AI proposal route while preserving the independently deployable AI service and its no-silent-mutation boundary.

## Decision

The private authenticated gateway signs a versioned context containing the canonical UUIDv4 workspace identifier, canonical UUIDv4 actor identifier, and Unix issuance time. The AI service accepts that context only when an HMAC-SHA256 tag verifies with the configured shared secret and the issuance time is within a bounded replay window.

The canonical message is:

```text
life-os.ai-context.v1\n<workspace_id>\n<actor_id>\n<issued_at>
```

The signature is the untruncated 32-byte HMAC-SHA256 output encoded as unpadded RFC 4648 base64url. Verification uses a constant-time comparison after strict fixed-shape validation. The configured secret must contain at least 32 UTF-8 bytes and must be generated and stored as secret material rather than copied from the documented placeholder.

## Standards basis

- RFC 2104 defines HMAC as keyed-hash message authentication and requires strong secret-key generation, protection, and refresh practices.
- FIPS 198-1 remains NIST's published final HMAC standard as of August 4, 2026. NIST proposed withdrawing it in 2025 and moving the maintained specification to SP 800-224; SP 800-224 remains an Initial Public Draft, so this slice records the transition rather than misrepresenting the draft as final.
- NIST's hash-function policy encourages SHA-256 at minimum for interoperable hash applications and permits SHA-2 for secure-hash applications.
- RFC 4648 defines the URL- and filename-safe base64 alphabet and canonical encoding behavior used for the tag header.
- RFC 9457 defines the machine-readable problem-detail response shape used for authentication and configuration failures.

## Trust boundary

- The browser, model provider, and independent client cannot select `workspace_id` or `actor_id` through JSON, query parameters, `x-workspace-id`, or `x-actor-id`.
- Only a private gateway that has already authenticated the session and authorized workspace membership may create the signed headers.
- The AI service authenticates the context tag and freshness; it does not independently prove that the gateway performed correct membership authorization.
- Proposal generation and audit operations remain inert. Accepting a proposal decision records append-only evidence and does not execute a planning, habit, calendar, notification, or other user-data command.
- The shared HMAC secret authenticates the calling gateway, not an end user. Compromise of that secret permits context forgery and therefore requires immediate coordinated rotation and incident review.

## Delivered boundary

- `apps/ai-service/src/gateway-context.ts` validates configuration, identifiers, timestamps, canonical tag shape, freshness, and HMAC authenticity.
- Every proposal create, list, get, decision-history, and append-decision route derives workspace and actor scope from the verified context.
- Health remains credential-free and does not consume tenant context.
- Legacy ownership headers are ignored as authorization input.
- Invalid, malformed, stale, future-dated, or forged contexts return a stable `401 invalid_gateway_context` problem.
- Missing or insufficient verifier configuration returns a stable `503 gateway_context_unavailable` problem.
- Unit and HTTP tests cover exact freshness boundaries, signature binding, legacy-header refusal, configuration failure, tenant isolation, signed actor attribution, and the continued absence of an apply route.

## Deployment and rotation

1. Generate at least 32 bytes of cryptographically random secret material in the deployment secret manager.
2. Configure the same value as `AI_GATEWAY_CONTEXT_SECRET` in the private signer and AI-service verifier without exposing it to browsers, logs, metrics, build artifacts, or repository variables available to untrusted pull requests.
3. Deploy the verifier before routing signed production requests to the AI service.
4. Deploy the signer and verify successful authenticated proposal traffic within the 60-second maximum context age and five-second future-clock tolerance.
5. Remove any edge route that forwards legacy ownership headers as authority.

This slice supports one active secret. A rotation therefore requires a coordinated signer/verifier deployment or a temporary maintenance boundary; it does not claim zero-downtime key rotation. A later slice may add explicit key identifiers and a bounded overlapping verification window after separate review.

## Failure and rollback

- Authentication failures fail closed and never fall back to legacy headers.
- Clock drift beyond the bounded tolerance fails closed; operators must correct time synchronization rather than widen the replay window informally.
- Rolling back only the signer would make requests fail authentication. Rolling back both signer and verifier to raw ownership headers would reopen the vulnerability and is not an acceptable production rollback.
- A safe rollback disables external AI proposal traffic while restoring a mutually compatible signed-context version.
- Secret compromise requires replacing the secret in both components, invalidating prior context tags by waiting at least the maximum context age, reviewing audit evidence for forged activity, and documenting the incident.

## Deferred work

- Gateway or same-origin BFF session introspection and production context signing.
- Multiple active verification keys and zero-downtime rotation.
- Asymmetric workload identity or service-mesh authentication.
- Fine-grained action authorization beyond authenticated workspace membership.
- Durable replay identifiers if the context contract later authorizes non-idempotent execution.

## Verification gate

The exact pull-request head must pass formatting, lint, type checking, all unit and PostgreSQL integration tests, build, Compose validation, AppGuardrail, SAST Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and every actionable human or security review finding. No review thread may remain unresolved at merge.

## References

Josefsson, S. (2006). *The Base16, Base32, and Base64 data encodings* (RFC 4648). RFC Editor. https://doi.org/10.17487/RFC4648

Krawczyk, H., Bellare, M., & Canetti, R. (1997). *HMAC: Keyed-hashing for message authentication* (RFC 2104). RFC Editor. https://doi.org/10.17487/RFC2104

National Institute of Standards and Technology. (2008). *The keyed-hash message authentication code (HMAC)* (FIPS PUB 198-1). U.S. Department of Commerce. https://doi.org/10.6028/NIST.FIPS.198-1

National Institute of Standards and Technology. (2022, December 15). *NIST's policy on hash functions*. https://csrc.nist.gov/Projects/Hash-Functions/NIST-Policy-on-Hash-Functions

National Institute of Standards and Technology. (2025, June 23). *Proposed withdrawal of FIPS 198-1, keyed-hash message authentication code (HMAC)*. https://csrc.nist.gov/news/2025/proposed-withdrawal-of-fips-198-1-hmac

Nottingham, M., Wilde, E., & Dalal, S. (2023). *Problem details for HTTP APIs* (RFC 9457). RFC Editor. https://doi.org/10.17487/RFC9457

Turan, M. S., & Brandão, L. T. A. N. (2024). *Keyed-hash message authentication code (HMAC): Specification of HMAC and recommendations for message authentication* (NIST SP 800-224 Initial Public Draft). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-224.ipd
