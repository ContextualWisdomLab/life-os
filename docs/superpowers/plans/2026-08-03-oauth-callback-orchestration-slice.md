# OAuth Callback Orchestration Slice

## Goal

Continue issue #18 by composing the existing single-use OAuth transaction, fixed Google and GitHub provider clients, identity provisioning, workspace session, browser-cookie, fixed-origin redirect, and audit primitives into one provider-neutral callback application boundary.

## Included

- parse only the bounded callback query surface and require one opaque correlation identifier
- require the provider-bound browser cookie before consuming callback state exactly once
- consume provider-error callbacks without contacting the provider so their state cannot be replayed
- route Google codes through the local OIDC signature and claim verifier with the transaction PKCE verifier and nonce
- route GitHub codes through the fixed token, user, and verified-email client with the consumed transaction
- normalize the provider result into the existing external-identity provisioning service
- provision or reuse the internal user and personal workspace before issuing an opaque workspace-scoped session
- serialize the session as a bounded Secure, HttpOnly, SameSite=Lax cookie and redirect only to the configured LifeOS web origin
- emit credential-free success or failure audit events containing provider, outcome, correlation ID, and internal user/workspace IDs when available
- revoke a newly issued session if cookie serialization or success-audit persistence fails
- map parsing, state, browser binding, provider, provisioning, session, cookie, and audit failures to one generic callback error

## Verification

- unit tests cover successful Google and GitHub completion, fixed redirect and cookie attributes, provider input binding, large GitHub string subjects, state replay, provider-error consumption, cross-browser state use, provider mismatch, malformed callback parameters, provider diagnostic redaction, credential-free audit records, and compensating session revocation
- formatting, TypeScript compilation, the full repository test suite, build, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and all human/security review feedback must pass on the exact merge head

## Follow-up

Wire this callback application into the NestJS controller and runtime dependency graph, then add PostgreSQL-backed end-to-end callback, session introspection, rotation/revocation, cookie, audit, and concurrent first-sign-in tests.
