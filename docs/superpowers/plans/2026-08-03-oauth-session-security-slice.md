# OAuth Transaction and Session Security Slice

**Goal:** Establish provider-neutral OAuth transaction and web-session primitives before adding Google and GitHub protocol adapters.

## Tasks

- [x] Generate cryptographically random OAuth state values and PKCE S256 verifier/challenge pairs.
- [x] Store only a hash of OAuth state and consume each transaction atomically once.
- [x] Reject expired, replayed, and provider-mismatched OAuth callbacks with one generic failure.
- [x] Issue opaque session credentials while persisting only SHA-256 token hashes.
- [x] Support session authentication, expiry, and revocation.
- [x] Enforce UUIDv4 internal user and session identifiers.
- [x] Add a PostgreSQL session migration with no raw credential storage.
- [ ] Run CI, SAST, Security Scan, and review feedback; fix all actionable findings.

## Deliberate boundary

Provider authorization URLs, authorization-code exchange, OIDC claim validation, secure cookie transport, and PostgreSQL repository adapters are deferred to the next slice. OAuth transaction records are currently ephemeral and in-memory; a production adapter must preserve atomic single-use consumption and protect the PKCE verifier at rest.
