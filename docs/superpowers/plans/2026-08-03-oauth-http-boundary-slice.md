# OAuth HTTP Boundary Slice

## Goal

Create the security-critical browser boundary that the Google and GitHub callback orchestration in issue #18 will use. This slice intentionally does not claim to complete provider token exchange, Google JWKS verification, account provisioning, or callback routing.

## Included

- bounded Cookie header parsing that rejects duplicate, quoted, malformed, or oversized opaque cookies
- secure browser-binding and application-session cookie serialization
- strict callback query parsing with one `code` or one provider `error`, one `state`, no repeated security-sensitive values, and no arbitrary redirect input
- a fixed HTTPS post-login destination derived only from configured web origin
- RFC 9457-compatible credential-free problem bodies
- authorization-start coordination using the existing state, PKCE, nonce, redirect-URI, and transaction persistence primitives
- session introspection that never returns the bearer token
- idempotent logout that revokes the server-side session before clearing the browser cookie

## Verification

- unit tests cover malformed and duplicate cookies, callback ambiguity, unknown callback parameters, browser-binding reuse, Google PKCE and nonce, GitHub authorization start, fixed redirect enforcement, token-free session introspection, revocation, and idempotent logout
- TypeScript compilation and the full repository test suite remain required
- CI, SAST Semgrep, Security Scan, AppGuardrail, Commercial Readiness, and review feedback must pass before merge

## Follow-up

The next slice should add production NestJS controllers and dependency wiring for PostgreSQL-backed transactions and sessions, then orchestrate fixed-endpoint token exchange, Google JWKS signature validation, GitHub identity retrieval, atomic account provisioning, secure session issuance, audit events, and generic callback error mapping.
