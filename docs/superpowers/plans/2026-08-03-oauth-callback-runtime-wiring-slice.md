# OAuth Callback Runtime Wiring Slice

## Goal

Continue issue #18 by publishing the Google and GitHub callback routes and wiring the callback application to the production PostgreSQL, provider, session, identity, redirect, and audit dependencies.

## Included

- publish fixed GET callback routes for Google and GitHub
- bind the provider, bounded callback query, browser cookie, and correlation header to the callback application
- return only a no-store 303 response carrying the opaque application-session cookie and fixed LifeOS web redirect
- map callback authentication failures and unexpected internal failures to stable credential-free problem responses
- construct the callback application from the existing PostgreSQL transaction/session repositories and PostgreSQL identity provisioner
- expose a transactional PostgreSQL adapter for atomic first-sign-in provisioning
- construct the fixed Google OIDC and GitHub OAuth clients from required startup configuration
- require Google and GitHub client credentials at startup rather than discovering missing secrets during a callback
- emit structured credential-free callback audit records containing only provider, outcome, correlation ID, and internal user/workspace IDs
- inject the callback application into the NestJS controller through an explicit runtime token

## Verification

- controller tests cover route metadata, exact callback bindings, secure cookie/redirect behavior, no-store responses, and diagnostic redaction
- runtime tests cover callback dependency construction, required provider credentials, bounded database configuration, and idempotent shutdown
- formatting, TypeScript compilation, the full repository test suite, build, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and all human/security review feedback must pass on the exact merge head

## Follow-up

Add PostgreSQL-backed end-to-end callback tests against real provider-client fixtures, persist audit events through a dedicated append-only audit repository, and add session rotation/revocation plus concurrent first-sign-in coverage before closing issue #18.
