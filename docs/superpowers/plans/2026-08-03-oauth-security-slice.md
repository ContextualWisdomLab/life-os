# OAuth Security Hardening Slice

**Issue:** #8  
**Goal:** Harden the existing OAuth transaction, provider-request, token-exchange, and application-session foundation without creating a parallel security implementation.

## Tasks

- [x] Review the merged identity and OAuth foundation before extending it.
- [x] Write failing tests for browser-session binding, redirect binding, runtime provider validation, TTL validation, workspace-scoped sessions, rotation, and idempotent revocation.
- [x] Verify the hardening tests fail against the existing `auth-security` API and behavior.
- [x] Generate transaction-specific random state and PKCE verifiers.
- [x] Derive PKCE challenges using RFC 7636 `S256`.
- [x] Bind transactions to provider, initiating browser session, and normalized redirect URI.
- [x] Require the authorization request and token exchange to use the transaction's redirect URI.
- [x] Consume callbacks once and reject expired or mismatched transactions.
- [x] Issue opaque session bearer tokens while retaining only SHA-256 digests.
- [x] Bind sessions to both user and owned workspace.
- [x] Support session authentication, rotation, expiry, and idempotent revocation.
- [x] Extend the PostgreSQL schema without numeric identifiers or duplicate migration numbers.
- [x] Consolidate redirect URI validation and remove the duplicate OAuth security module.
- [x] Record encryption-at-rest, atomic consumption, and cookie-delivery requirements in an ADR.
- [x] Run CI, SAST, Security Scan, and review feedback; fix all actionable findings.
