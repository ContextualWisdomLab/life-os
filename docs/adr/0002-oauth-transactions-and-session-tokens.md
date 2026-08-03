# ADR 0002: OAuth transactions and session tokens

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

LifeOS accepts Google and GitHub sign-in while maintaining provider-neutral internal identity records. Authorization callbacks must resist cross-site request forgery, authorization-code injection, provider mix-up, replay, and token disclosure. Internal identifiers must remain opaque, non-numeric, and non-sequential.

## Decision

### Authorization transactions

- Every authorization attempt receives a cryptographically random, one-time `state` value.
- The server persists only a SHA-256 digest of `state`.
- The transaction is bound to both the selected provider and a digest of the initiating browser session identifier.
- Transactions expire after ten minutes by default and are consumed once.
- Provider adapters must consume transactions atomically. A PostgreSQL adapter must use a conditional update or delete with `RETURNING`, scoped to an unconsumed and unexpired row.
- Authorization requests use PKCE with the `S256` method. The verifier is a 32-byte random base64url value; the challenge is `BASE64URL(SHA256(verifier))`.
- The verifier is server-side material. Persistent implementations must encrypt it at rest; it must not be returned to the browser.
- Each provider uses a distinct callback route or equivalent issuer verification to prevent authorization-server mix-up.

### Application sessions

- Session bearer tokens are cryptographically random base64url values and are not entity identifiers.
- Only a SHA-256 digest of a session token is persisted.
- Session records use random UUIDv4 primary keys.
- Session rotation revokes the previous token before issuing a replacement and records the previous session ID.
- Revocation is idempotent and does not disclose whether a supplied token existed.
- Browser delivery uses `Secure`, `HttpOnly`, and an explicit `SameSite` policy. Production deployments must never place session tokens in URLs, logs, local storage, analytics payloads, or application telemetry.

## Standards basis

- RFC 7636, *Proof Key for Code Exchange by OAuth Public Clients*: https://www.rfc-editor.org/rfc/rfc7636
- RFC 9700 / BCP 240, *Best Current Practice for OAuth 2.0 Security*: https://www.rfc-editor.org/rfc/rfc9700
- GitHub OAuth authorization flow: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps

## Consequences

- Stolen database rows do not directly reveal usable `state` or session bearer values.
- OAuth transactions and sessions require expiry cleanup jobs.
- A production repository needs encryption-key management for PKCE verifiers.
- Provider callback adapters remain responsible for token exchange, provider response validation, and profile retrieval; this ADR supplies the transaction and session primitives they must use.
