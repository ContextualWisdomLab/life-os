# ADR 0002: OAuth transactions, session tokens, and authentication provenance

**Status:** Accepted architecture  
**Date:** 2026-08-03

## Context

LifeOS supports Google and GitHub sign-in while maintaining provider-neutral internal identity. OAuth callbacks must resist state/code injection, mix-up, replay, redirect substitution and bearer disclosure. Session rotation must not accidentally reset the real authentication age used by sensitive recent-authentication gates.

## Decision drivers

- provider-neutral identity;
- tenant-safe session scope;
- replay-resistant OAuth transactions;
- recent-authentication correctness;
- secret minimization in persistence/logging;
- compatibility with protected-main identity migrations/tests.

## Considered alternatives

1. **Trust provider callback parameters without a server transaction** — rejected.
2. **Persist raw state/session bearer values** — rejected.
3. **Treat every session rotation as a new authentication ceremony** — rejected because it can defeat recent-authentication policy.
4. **Server-owned one-time OAuth transactions plus digest-only sessions and explicit authentication provenance** — selected.

## Decision

### Authorization transactions

- generate cryptographically random one-time `state` and persist only its digest;
- bind transaction to provider, initiating browser-session context and normalized redirect URI;
- expire and atomically consume transactions;
- use PKCE S256 and keep verifier/nonce as server-side sensitive material;
- use distinct callback/issuer validation adequate to prevent provider mix-up;
- require HTTPS redirects except narrowly bounded loopback development cases.

### Application sessions

- bearer tokens are random secrets, not entity identifiers;
- persist only bearer digests;
- session records use UUIDv4 and bind user plus authorized workspace;
- rotation revokes the previous bearer/session path according to the domain contract;
- browser cookies are Secure/HttpOnly with explicit SameSite policy;
- bearer/session values never enter URLs, analytics, logs or public artifacts.

### Authentication provenance

- store the authentication instant separately from session issuance/rotation time;
- compatible session rotation preserves the original authentication instant;
- a recent-authentication policy evaluates the authentication ceremony age, not token/session age;
- malformed/future/stale provenance fails closed for sensitive operations.

## Consequences

- OAuth transactions and sessions need expiry cleanup;
- production deployments need encryption/key management for server-side OAuth verifier/nonce material where persisted;
- callers must preserve exact provider/redirect/browser-transaction binding;
- sensitive operations can distinguish a fresh bearer from a genuinely fresh authentication event.

## Failure and recovery

Consumed/expired/mismatched OAuth transactions fail without reusing state. Session rotation failure must not leave two unexpectedly authoritative bearers. Authentication-age migration uses staged compatibility/finalization so existing sessions cannot silently receive a fictitious fresh-auth timestamp.

## Security and privacy impact

Database disclosure does not directly reveal usable OAuth state or session bearer material. Provider identities stay separate from LifeOS primary IDs. Recent-authentication checks are resistant to token/session refresh being used as policy bypass.

## Acceptance evidence

Protected main contains OAuth/session transaction tests, session rotation migrations, authentication-age migration/tests and recent-authentication data-rights policy/application tests integrated through #134-#137.

## Migration and rollback

Identity migrations stage authentication provenance and finalize the required constraints only after compatible data state exists. Rollback/forward-fix must preserve the distinction between authentication time and session issuance; removing the new column/contract without policy reconciliation is unsafe.

## Supersession

This ADR remains authoritative for LifeOS login/session/authentication-provenance behavior until a later accepted ADR and protected-main migration/test evidence explicitly replace it.

## Standards basis

- RFC 7636, *Proof Key for Code Exchange by OAuth Public Clients*.
- RFC 9700 / BCP 240, *Best Current Practice for OAuth 2.0 Security*.