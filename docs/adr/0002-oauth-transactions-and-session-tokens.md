# ADR 0002: OAuth transactions and session tokens

**Status:** Accepted architecture  
**Date:** 2026-08-03

## Context

LifeOS supports Google and GitHub sign-in while maintaining provider-neutral internal identity. Authorization callbacks must resist CSRF, code injection, mix-up, replay, redirect substitution and bearer-token disclosure. Session rotation must not erase authentication provenance needed by sensitive operations such as data-rights requests.

## Decision drivers

- provider-neutral internal identity;
- current OAuth security best practice;
- server-verifiable and revocable browser sessions;
- tenant/workspace binding independent from browser-selected IDs;
- recent-authentication evidence that survives token/session rotation.

## Alternatives considered

1. Trust client OAuth state/callback metadata: rejected.
2. Persist raw session bearer values: rejected.
3. Reuse provider account IDs as LifeOS IDs: rejected by ADR 0001.
4. Treat session rotation time as authentication time: rejected because it weakens sensitive-operation recency semantics.
5. Server-owned OAuth transaction + hashed bearer/session lifecycle: selected.

## Decision

### Authorization transactions

- Use cryptographically random one-time `state`, storing only its SHA-256 digest.
- Bind transaction to provider, initiating browser-session digest and normalized redirect URI.
- Use the same exact redirect URI for authorization and token exchange.
- Expire transactions after a bounded lifetime and consume them once atomically.
- Use PKCE `S256` with server-held verifier and validate Google OIDC nonce where applicable.
- Encrypt persistent PKCE verifier/nonce material at rest.
- Use distinct provider callback/issuer validation to prevent mix-up.
- Require HTTPS redirects except documented loopback HTTP development cases.

### Application sessions

- Session bearer tokens are random base64url secrets; only SHA-256 digests persist.
- Session records use UUIDv4 and bind user plus authorized workspace.
- Rotation revokes the predecessor before replacement and preserves lineage/authentication provenance.
- Authentication age is not reset merely by rotation.
- Browser delivery uses `Secure`, `HttpOnly` and explicit `SameSite`; tokens never enter URLs, logs, local storage or telemetry.

## Consequences

Production identity persistence requires cleanup and encryption-key management. Callers must supply exact transaction/session context instead of reconstructing authority from browser headers. Sensitive flows can enforce recent authentication correctly across rotation.

## Failure and recovery

Unknown/expired/consumed/malformed transactions fail closed. Revocation remains idempotent and non-enumerating. Migration of authentication provenance is staged/validated so legacy rows cannot silently gain fresh-auth status.

## Security and privacy impact

Database compromise does not directly expose usable state/session bearer values. Authentication provenance itself is security-sensitive metadata and follows identity-service access/retention controls.

## Acceptance evidence

Protected-main identity source/migrations/tests cover OAuth transaction security, session hashing/rotation, authentication-age persistence and recent-authentication policy. RFC 9700 is the current OAuth 2.0 security BCP; PKCE remains part of the provider flow contract.

## Migration and rollback

Migrations introduce workspace/session binding and authentication provenance with validation before final enforcement. Rollback cannot reinterpret newer authentication evidence as fresh; use explicit forward-fix/migration procedures.

## Supersession

This ADR is superseded only by a reviewed identity/session architecture change with provider, migration, recent-auth and browser-security compatibility evidence.

## References

GitHub. (n.d.). *Authorizing OAuth apps*. https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps

Lodderstedt, T., Bradley, J., Labunets, A., & Fett, D. (2025). *Best current practice for OAuth 2.0 security* (RFC 9700; BCP 240) [Published Best Current Practice]. RFC Editor. https://doi.org/10.17487/RFC9700

Sakimura, N., Bradley, J., & Agarwal, N. (2015). *Proof key for code exchange by OAuth public clients* (RFC 7636) [Published Standards Track RFC]. RFC Editor. https://doi.org/10.17487/RFC7636
