# AI gateway key rotation standards review

Date: 2026-08-04  
Capability: `ai.auditable-proposals`  
Slice: zero-downtime private gateway HMAC key rotation

## Decision summary

LifeOS will identify every signed private gateway context with one bounded, case-sensitive opaque key identifier. The identifier is integrity-protected by inclusion in the canonical HMAC input. The web gateway signs only with one active key. The AI service resolves exactly the explicitly identified active or previous key and never trials every configured key.

Configuration permits exactly one active key and at most one complete previous verification key. Missing, partial, duplicate, malformed, unknown, or retired identifiers fail closed. Key material remains server-only, is generated independently, is bounded before cryptographic use, and is excluded from logs and problem responses.

This design supports a gradual write-new/read-old rotation pattern while limiting overlap and ambiguity. The overlap key is verification-only; retirement removes it from configuration rather than leaving an unbounded historical key set.

## Standards rationale

### Key lifecycle and bounded overlap

NIST SP 800-57 Part 1 Revision 5 treats cryptographic keys and their metadata as managed assets with defined lifecycle states, protection requirements, cryptoperiods, and accountability. The implementation therefore treats the identifier as protected key metadata, requires explicit active and previous roles, and documents deployment, activation, retirement, and emergency revocation.

OWASP recommends automated secret rotation, gradual rotation strategies that introduce new credentials for write operations while temporarily retaining old credentials for read or verification operations, least privilege, lifecycle metadata, and immediate revocation of no-longer-required secrets. The two-slot keyring is a deliberately bounded realization of that guidance.

### Explicit key identification

RFC 7515 defines `kid` as a case-sensitive key identifier that allows an originator to signal which key secured a message and explicitly supports key change. RFC 8725 warns that received key identifiers must be validated before lookup so they cannot become injection primitives. LifeOS therefore uses a short ASCII allowlist and direct equality selection against two in-memory configured identifiers. The identifier is not accepted as a path, URL, database query, environment-variable name, or secret-store locator.

### Authentication construction

The existing boundary uses HMAC-SHA-256, constant-time comparison, a versioned canonical input, exact method and path binding, authenticated workspace and actor identifiers, and a short issuance window. Rotation extends the canonical input with the key identifier and advances the context version so keyed and unkeyed messages cannot be confused.

## Normative implementation constraints

1. Header name: `x-life-os-context-key-id`.
2. Identifier grammar: 1–64 case-sensitive ASCII characters; first character alphanumeric; remaining characters alphanumeric, period, underscore, or hyphen.
3. Canonical input version: `life-os.ai-context.v2`.
4. Canonical field order: version, key identifier, workspace identifier, actor identifier, issued-at seconds, uppercase method, exact canonical path.
5. Active key variables: `AI_GATEWAY_ACTIVE_KEY_ID` and `AI_GATEWAY_ACTIVE_KEY_SECRET`.
6. Optional previous variables: `AI_GATEWAY_PREVIOUS_KEY_ID` and `AI_GATEWAY_PREVIOUS_KEY_SECRET`.
7. Previous identifier and secret must either both be absent or both be present.
8. Active and previous identifiers must be distinct.
9. The gateway signs only with the active key.
10. The verifier selects one key by exact identifier equality before computing HMAC. It must not attempt all keys.
11. Missing, malformed, or unknown request identifiers return the existing credential-free invalid-context problem.
12. Invalid local key configuration returns the existing credential-free unavailable-context problem.
13. No secret value, signature, or untrusted identifier is written to logs or problem details.
14. Overlap ends by removing the previous pair after all in-flight v2 contexts signed with it have expired.

## References

Barker, E. (2020). *Recommendation for key management: Part 1—General* (NIST Special Publication 800-57 Part 1 Revision 5). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-57pt1r5

Jones, M., Bradley, J., & Sakimura, N. (2015). *JSON Web Signature (JWS)* (RFC 7515). Internet Engineering Task Force. https://doi.org/10.17487/RFC7515

Sheffer, Y., Hardt, D., & Jones, M. (2020). *JSON Web Token best current practices* (RFC 8725). Internet Engineering Task Force. https://doi.org/10.17487/RFC8725

OWASP Foundation. (n.d.). *Secrets management cheat sheet*. OWASP Cheat Sheet Series. Retrieved August 4, 2026, from https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
