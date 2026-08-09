# ADR 0002: OAuth transactions and session tokens

**Status:** Implemented on protected main  
**Date:** 2026-08-03  
**Identity note:** This historical ADR already used number `0002` before the canonical documentation baseline introduced `0002-internal-identifiers-uuidv4.md`. The repository therefore treats the full ADR filename, not the four-digit prefix alone, as the stable index identity for pre-baseline collisions.

## Context

LifeOS accepts Google and GitHub sign-in while maintaining provider-neutral internal identity records. Authorization callbacks must resist cross-site request forgery, authorization-code injection, authorization-server mix-up, replay, redirect substitution, and bearer-token disclosure. Internal identifiers must remain opaque, non-numeric, and non-sequential.

The repository already contained provider authorization and token-exchange builders. This decision hardens the shared `auth-security` transaction and session layer rather than introducing a second implementation.

## Drivers

- prevent authorization response injection, replay, redirect substitution, and authorization-server mix-up;
- keep bearer/session credentials out of durable plaintext storage and public diagnostics;
- retain provider-neutral internal identity and workspace authority;
- make browser sessions revocable and safely rotatable;
- preserve exact callback and PKCE/OIDC transaction binding with bounded lifetime.

## Alternatives

1. Trust provider callbacks without a durable one-time transaction record.
2. Persist raw `state`, session bearer tokens, PKCE verifiers, or provider tokens as ordinary application values.
3. Share one ambiguous callback/issuer path for every provider without explicit provider binding.
4. Keep the provider adapters but centralize the transaction/session primitives in the identity boundary, as selected here.

## Decision

### Authorization transactions

- Every authorization attempt receives a cryptographically random, one-time `state` value.
- The server persists only a SHA-256 digest of `state`.
- The transaction is bound to the selected provider, a digest of the initiating browser session identifier, and the normalized redirect URI.
- The same redirect URI must be used when building the authorization request and exchanging the authorization code.
- Transactions expire after ten minutes by default and are consumed once.
- Provider adapters must consume transactions atomically. A PostgreSQL adapter must use a conditional update or delete with `RETURNING`, scoped to the provider, state digest, browser-session digest, unconsumed status, and expiry.
- Authorization requests use PKCE with the `S256` method. The verifier is a 64-byte random base64url value and the challenge is `BASE64URL(SHA256(verifier))`.
- The verifier and Google OIDC nonce are server-side material. Persistent implementations must encrypt them at rest; neither is returned to the browser except that the nonce is included in the Google authorization request.
- Each provider uses a distinct callback route or equivalent issuer verification to prevent authorization-server mix-up.
- Redirect URIs require HTTPS, except for loopback HTTP during local development, and may not contain credentials or fragments.

### Application sessions

- Session bearer tokens are cryptographically random base64url values and are not entity identifiers.
- Only a SHA-256 digest of a session token is persisted.
- Session records use random UUIDv4 primary keys and bind both a user and one of that user's workspaces.
- The database enforces workspace ownership with a composite foreign key.
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
- A production repository needs encryption-key management for PKCE verifiers and OIDC nonces.
- Existing callers must supply the initiating browser-session identifier and the exact redirect URI when creating and consuming transactions.
- Existing sessions are backfilled to their owners' personal workspaces by migration `0003_oauth_binding_and_session_rotation.sql`.
- Provider callback adapters remain responsible for network exchange, provider response validation, ID-token validation for Google, and profile retrieval; this ADR supplies the transaction and session primitives they must use.

## Failure and recovery

Malformed, expired, replayed, provider-mismatched, browser-session-mismatched, or redirect-mismatched authorization transactions fail closed before token exchange or identity mutation. A failed session rotation does not make a new bearer token authoritative until its replacement session has been persisted under the identity-service transaction boundary. Provider/network failures remain sanitized dependency failures rather than exposing token responses.

## Security and privacy impact

Only digests of one-time `state` and session bearer values are durable. Provider credentials, PKCE verifier material, OIDC nonces, and browser session tokens stay within their reviewed identity/provider boundary. Opaque identifiers do not replace workspace authorization, and a valid provider identity never grants access to an unrelated LifeOS workspace.

## Acceptance evidence

Protected main contains the identity-service transaction/session implementation, OAuth callback/provider integration tests, UUIDv4/session ownership migrations, replay/expiry/redirect/provider-binding regressions, and credential-safe browser-session handling. Exact source and migration evidence remains authoritative over this prose.

## Migration / rollback

Migration `0003_oauth_binding_and_session_rotation.sql` backfilled existing sessions to their owners' personal workspaces and established the rotation/ownership constraints used by the implemented boundary. Future changes to token storage, authentication-age semantics, provider binding, or credential encryption require forward-compatible migration evidence and must not silently reinterpret existing session provenance.

## Supersession

This decision remains implemented on protected main. It is superseded only by a later indexed ADR that preserves or explicitly migrates the transaction anti-replay, PKCE/OIDC, provider-binding, credential-storage, workspace-authority, and session-rotation security properties. The duplicated historical `0002` numeric prefix is not itself a reason to discard or rewrite this ADR's decision history; canonical indexing uses the full filename for identity.
