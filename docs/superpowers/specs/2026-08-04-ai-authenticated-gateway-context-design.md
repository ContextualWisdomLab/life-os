# Authenticated AI Proposal Gateway Context Design

## Status

Approved for autonomous implementation under issue #108 and the repository's commercial-readiness loop.

## Goal

Expose the merged inert AI proposal and append-only audit APIs through a same-origin browser boundary while ensuring workspace and actor identity can only originate from an authenticated identity-service session.

## Context

PR #105 made proposal generation durable and added tenant-scoped immutable proposal and decision evidence. Its AI service routes still receive `x-workspace-id` and `x-actor-id` directly. That is acceptable only behind a private trusted gateway and is not a complete browser-facing authorization boundary.

LifeOS already has a proven planning-search pattern: the web BFF introspects the opaque browser session through identity-service, derives the authorized workspace, signs a short-lived HMAC service context, and calls planning-service without forwarding browser credentials. This slice extends that pattern to AI proposals and additionally binds the authenticated user as the decision actor.

## Architecture

### Browser boundary

The web application exposes five same-origin routes:

- `POST /api/ai/proposals`
- `GET /api/ai/proposals`
- `GET /api/ai/proposals/:proposalId`
- `GET /api/ai/proposals/:proposalId/decisions`
- `POST /api/ai/proposals/:proposalId/decisions`

Route handlers delegate to one server-only `ai-proposal-client.ts` module. That module:

1. validates the browser method, path parameters, content type, body size, and closed JSON shape;
2. sends the browser cookie only to identity-service `GET /v1/session`;
3. validates `workspaceId` and `userId` as UUIDv4 values from the session response;
4. creates a random correlation identifier;
5. signs the exact AI service method and path with `AI_GATEWAY_CONTEXT_SECRET`;
6. calls AI service with the signed context and no browser cookie;
7. bounds and validates the AI response before returning it to the browser.

The BFF remains independently replaceable: another trusted proxy may implement the same documented service-context contract without importing web application code.

### AI service boundary

A new `ai-http-boundary.ts` module owns service-context verification and HTTP problem mapping. The controller receives service headers but does not trust them until the verifier confirms:

- `workspaceId` and `actorId` are canonical UUIDv4 strings;
- issued-at is a canonical Unix-seconds integer;
- method is one of the exact supported uppercase methods;
- path is the exact canonical route path constructed by the controller;
- signature is canonical 43-character base64url HMAC-SHA-256;
- timestamp is no older than 60 seconds and no more than 5 seconds in the future;
- the configured secret is at least 32 UTF-8 bytes and at most 4096 bytes;
- constant-time digest comparison succeeds.

The controller passes only the verified workspace and actor values to the existing proposal/audit application. It ignores and rejects legacy client-selectable ownership headers.

### Versioned HMAC contract

Headers:

- `x-life-os-workspace-id`
- `x-life-os-actor-id`
- `x-life-os-context-issued-at`
- `x-life-os-context-signature`

Payload, encoded as UTF-8 with LF separators and no trailing LF:

```text
life-os.ai-context.v1
<workspace_id>
<actor_id>
<issued_at_unix_seconds>
<uppercase_http_method>
<exact_path>
```

Examples of exact paths:

- `/v1/proposals`
- `/v1/proposals/<proposal_uuid>`
- `/v1/proposals/<proposal_uuid>/decisions`

Binding method and path prevents a valid short-lived context for one read operation from authorizing a decision append or another proposal.

## Data flow

### Proposal generation

1. Browser posts a closed proposal request to `/api/ai/proposals`.
2. Web BFF validates and bounds the body.
3. BFF introspects the opaque session cookie at identity-service.
4. BFF derives workspace and actor UUIDs, signs `POST /v1/proposals`, and forwards only canonical JSON plus service headers.
5. AI service verifies the service context.
6. Existing proposal audit application generates and persists inert proposal evidence before return.
7. BFF validates the bounded proposal response and returns it with `Cache-Control: no-store` and the correlation identifier.

### Audit reads and decisions

Read routes use the same flow with `GET` and the exact proposal path. Decision append validates the closed decision request before forwarding it, signs `POST` for the exact decisions path, and derives actor identity exclusively from the session.

## Failure contract

Browser-facing responses use fixed RFC 9457-compatible bodies:

- `400 invalid_ai_request` for malformed/oversized request data;
- `401 authentication_required` when identity-service reports no active session;
- `404 proposal_not_found` only when the AI service returns the corresponding tenant-safe absence;
- `409 stale_proposal` and `409 idempotency_conflict` for explicit decision conflicts;
- `503 ai_proposal_unavailable` for configuration, transport, malformed upstream, timeout, or unexpected dependency failures.

AI service context failures use:

- `401 invalid_gateway_context` for malformed, stale, future, method/path-mismatched, or forged context;
- `503 gateway_context_unavailable` when the service cannot verify authenticity because configuration is absent or invalid.

No original exception text, cookie, URL credential, model content, database detail, or service secret is returned.

## Bounds

- cookie header: 4096 UTF-8 bytes;
- browser and upstream JSON body: 32 KiB;
- service origin: 2048 characters, HTTP(S), origin-only, no credentials/path/query/fragment;
- correlation identifier: generated UUIDv4 and never accepted from untrusted browser input;
- upstream timeout: 3000 ms;
- proposal UUID path parameter: canonical UUIDv4;
- gateway secret: 32–4096 UTF-8 bytes;
- context age: 60 seconds; future skew: 5 seconds.

## Security properties

- The browser never chooses workspace or actor identity.
- Browser cookies are sent only to identity-service.
- AI service accepts no unsigned ownership context.
- A signature is route- and method-specific.
- Decision requests cannot inject actor/workspace fields.
- All proposed operations remain inert; no execution route is added.
- The web BFF and AI verifier are bounded standalone modules with no shared in-memory state.
- Secret rotation is operator-owned; simultaneous dual-secret rotation is deferred to a separate reviewed slice.

## Modularity

The service-context format is a small provider-neutral contract. AI service remains independently deployable behind any trusted proxy that implements the contract. The web BFF is the default LifeOS composition but does not become a runtime dependency of the AI domain or PostgreSQL repository. The verifier has no Next.js dependency, and the BFF has no NestJS or database dependency.

## Testing

Test-first implementation must provide:

- verifier unit tests for exact success, missing/short/oversized secret, malformed IDs/timestamp/signature, stale/future context, method/path mismatch, and forgery;
- BFF unit tests proving identity-derived scope, cookie non-forwarding, exact signatures, closed request validation, bounded streams/media types, timeout/configuration failures, and response mapping;
- route-handler tests for Next.js 15 asynchronous dynamic parameters;
- AI HTTP integration evidence proving unsigned and path/method-replayed contexts fail and exact signed contexts preserve generation, reads, replay-safe decisions, tenant isolation, and no-execution routes;
- 100% statement, branch, and function coverage for every new helper and complete explanatory docstrings.

## Operations and documentation

Add `AI_SERVICE_ORIGIN` and `AI_GATEWAY_CONTEXT_SECRET` to `.env.example`. Document that the secret is server-only, at least 32 random bytes, shared only by the BFF/trusted proxy and AI service, and never sent to the browser. Update `CHANGELOG.md` under Unreleased.

## Standards

- RFC 2104 and RFC 4231: HMAC construction and HMAC-SHA-256 test basis.
- RFC 9110: method semantics and exact request targeting.
- RFC 9457: bounded problem details.
- OWASP ASVS server-side authorization and fail-closed trust-boundary principles.

## Non-goals

- external model-provider transport;
- proposal execution or mutation commands;
- generic gateway framework extraction;
- long-lived inter-service bearer tokens;
- body-digest signing in v1;
- multi-secret rotation windows;
- UI redesign or Figma work.
