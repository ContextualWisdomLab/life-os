# OAuth Security Slice

**Issue:** #8  
**Goal:** Add provider-neutral OAuth transaction verification and secure application-session primitives before implementing Google and GitHub network adapters.

## Tasks

- [x] Write failing tests for state, PKCE, binding, expiry, replay prevention, session hashing, rotation, and revocation.
- [x] Verify the tests fail because the OAuth security module is absent.
- [x] Generate transaction-specific random state and PKCE verifiers.
- [x] Derive PKCE challenges using RFC 7636 `S256`.
- [x] Bind transactions to provider and initiating browser session.
- [x] Consume successful callbacks once and reject expired transactions.
- [x] Issue opaque session bearer tokens while retaining only SHA-256 digests.
- [x] Support session authentication, rotation, expiry, and idempotent revocation.
- [x] Add PostgreSQL tables and indexes without numeric identifiers.
- [x] Record encryption-at-rest and cookie-delivery requirements in an ADR.
- [ ] Run CI, SAST, Security Scan, and review feedback; fix all actionable findings.
