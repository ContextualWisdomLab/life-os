# OAuth Controller and Runtime Wiring Slice

## Goal

Expose the already-reviewed OAuth browser boundary through production NestJS routes and compose it with PostgreSQL-backed transaction and session repositories using fail-closed runtime configuration.

## Included

- fixed Google and GitHub authorization-start endpoints
- token-free session introspection and idempotent logout endpoints
- explicit no-store responses, secure cookie forwarding, and RFC 9457-compatible generic error mapping
- startup composition for PostgreSQL repositories, AES-256-GCM OAuth secret protection, provider client configuration, and fixed web origin
- bounded database pool and timeout configuration
- deterministic pool shutdown through NestJS lifecycle hooks
- route, response, error-redaction, configuration, and lifecycle tests

## Security boundary

The controller never accepts a caller-selected redirect target, never serializes exception details, and never returns OAuth or application bearer material. Production startup fails when database, encryption-key, provider, redirect, or secure web-origin configuration is absent or invalid.

## Follow-up

The next reviewable slice should add provider callback controllers and orchestration over a bounded fixed-endpoint HTTP transport, beginning with Google token exchange and JWKS signature verification before account provisioning and session issuance.
