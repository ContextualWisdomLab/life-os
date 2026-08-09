# Durable Today synchronization standards

**Date:** 2026-08-09  
**Status:** Implemented on active PR #127  
**Scope:** HTTP concurrency, local-to-durable migration, bounded errors, browser accessibility

## Decision summary

Durable Today synchronization treats one `(workspace_id, local_date)` aggregate as a versioned HTTP resource. Browser-local Today data remains local until the user explicitly checks or saves workspace state. Initial creation uses `If-None-Match: *`; updates require a strong opaque `ETag` returned by the server and an exact `If-Match`. Missing write preconditions fail before mutation. Stale writes fail without returning the current document, and the UI requires another explicit read before either copy can replace the other.

This design separates four authorities:

1. the browser may author a local draft but cannot select a workspace identity;
2. identity-session introspection determines workspace scope;
3. planning-service owns durable persistence, revision rotation, and idempotency replay;
4. the user explicitly decides when local or workspace state replaces the other.

## Standards mapping

### HTTP conditional requests

RFC 9110 defines entity tags and conditional request fields. `If-Match` is specifically suitable for preventing lost updates on state-changing requests, while `If-None-Match: *` can prevent an unsafe request from overwriting an existing representation during create. LifeOS therefore rejects wildcard/weak/list update validators and exposes one strong opaque revision token for the complete Today aggregate.

The implementation deliberately uses a complete-document `PUT` rather than merging an untrusted partial document. A successful mutation rotates the revision token. A client that has not observed the current revision cannot claim overwrite authority.

### Required preconditions

RFC 6585 defines HTTP 428 `Precondition Required` for servers that require requests to be conditional. LifeOS uses 428 when neither an explicit create precondition nor an exact revision update precondition is present. This prevents an accidental unconditional overwrite from becoming a valid state transition.

### Problem details and disclosure minimization

RFC 9457 standardizes problem-details responses and cautions against exposing implementation internals through API errors. Today synchronization therefore returns fixed browser-safe problem shapes. A stale-write response may expose only the current opaque revision token; it does not expose the workspace document, database errors, credentials, SQL, internal URLs, or stack traces.

### Accessible explicit control

WCAG 2.2 is the accessibility target for the web UI. Synchronization state is conveyed with text in an `aria-live` status region rather than color alone, and checking, saving, replacing, and using workspace state remain ordinary keyboard-operable buttons. Browser acceptance tests exercise the workflow at desktop and mobile Chromium profiles.

## Product implications

- No background upload occurs on page load or local edit.
- A local draft remains usable when identity or planning services are unavailable.
- Conflict handling preserves both sides until the user performs another explicit check and chooses a direction.
- Idempotency and optimistic concurrency are separate: an idempotency key identifies one request replay, while the revision token proves the client's observed resource version.
- `local_date` is a literal user-local calendar date. The server does not reinterpret it through a deployment timezone.
- Calendar, notification, habit, review, and AI side effects are outside the planning persistence transaction and must consume explicit APIs/events rather than direct table access.

## Verification obligations

The active implementation must retain tests for:

- first creation with `If-None-Match: *`;
- strong exact `If-Match` update and revision rotation;
- missing/malformed precondition rejection;
- exact idempotent replay and conflicting key reuse;
- two-device stale-write conflict;
- workspace isolation and restart persistence against real PostgreSQL;
- explicit browser-local migration with zero network activity before user action;
- explicit recheck after a multi-device conflict;
- bounded and credential-free problem responses;
- keyboard/mobile/browser acceptance.

## References

Fielding, R., Nottingham, M., & Reschke, J. (2022). *HTTP semantics* (RFC 9110). Internet Engineering Task Force. https://www.rfc-editor.org/rfc/rfc9110

Nottingham, M., & Fielding, R. (2012). *Additional HTTP status codes* (RFC 6585). Internet Engineering Task Force. https://www.rfc-editor.org/rfc/rfc6585

Nottingham, M., Wilde, E., & Dalal, S. (2023). *Problem details for HTTP APIs* (RFC 9457). Internet Engineering Task Force. https://www.rfc-editor.org/rfc/rfc9457

World Wide Web Consortium. (2023). *Web Content Accessibility Guidelines (WCAG) 2.2*. https://www.w3.org/TR/WCAG22/
