# AI proposal-audit migrations

Apply AI service SQL files in lexical order to the PostgreSQL database owned by the AI service before starting the corresponding application version.

- `0001_proposal_audit.sql` creates immutable tenant-scoped proposal evidence and append-only accept/reject decision events.

## Production runtime

The production module requires `AI_DATABASE_URL` and accepts bounded optional pool controls:

- `AI_DATABASE_POOL_MAX`: integer from 1 through 32; default `10`
- `AI_DATABASE_CONNECT_TIMEOUT_MS`: integer from 100 through 30000; default `5000`
- `AI_DATABASE_IDLE_TIMEOUT_MS`: integer from 1000 through 300000; default `30000`

The node-postgres pool identifies itself as `life-os-ai-service`, records idle-client failures through a credential-free listener, and is closed exactly once after successful cleanup through the NestJS application-shutdown lifecycle. Concurrent shutdown calls share one attempt; a failed attempt remains visible and permits a later retry. Startup fails closed when the URL is missing, oversized, malformed, or not PostgreSQL.

## Proposal model runtime

The AI service remains independently usable with the deterministic local model:

```dotenv
AI_PROPOSAL_MODEL=rule-based
```

This is the default and records `rule-based-v1` in proposal evidence. To use the separately deployable contextual orchestrator, configure:

```dotenv
AI_PROPOSAL_MODEL=contextual-orchestrator
CONTEXTUAL_ORCHESTRATOR_URL=https://orchestrator.example.com
CONTEXTUAL_ORCHESTRATOR_TOKEN=<server-only-token>
AI_MODEL_REQUEST_TIMEOUT_MS=10000
```

External mode accepts one exact HTTPS origin, a 32–4096-byte token without header delimiters, and a timeout from 100 through 30000 milliseconds. AI service calls only `POST /v1/chat/completions`, supplies no tools, caps the streamed response at 65536 bytes, parses one schema-constrained JSON draft, and records `contextual-orchestrator-v1` in proposal evidence.

Provider selection, retries, circuit breaking, spend policy, and free-model-first fallback belong to contextual-orchestrator. LifeOS does not silently switch to the local model after external mode is selected. A model or transport failure returns a bounded unavailable response so audit provenance remains explicit. See `docs/operations/contextual-orchestrator-proposal-transport.md`.

## Versioned audit routes

The production module exposes the inert proposal-generation route together with tenant-scoped audit history:

- `POST /v1/proposals`
- `GET /v1/proposals`
- `GET /v1/proposals/:proposalId`
- `GET /v1/proposals/:proposalId/decisions`
- `POST /v1/proposals/:proposalId/decisions`

Every route requires a short-lived signed service context produced only after a trusted proxy authenticates a session and authorizes workspace membership. The headers are `x-life-os-context-key-id`, `x-life-os-workspace-id`, `x-life-os-actor-id`, `x-life-os-context-issued-at`, and `x-life-os-context-signature`. The version 2 HMAC-SHA-256 payload binds the case-sensitive key identifier, canonical workspace and actor UUIDv4 values, issuance time, uppercase HTTP method, and exact `/v1/...` path.

The trusted web boundary requires `AI_GATEWAY_ACTIVE_KEY_ID` and `AI_GATEWAY_ACTIVE_KEY_SECRET` and signs only with that pair. AI service requires the same active pair and may additionally receive the complete verification-only overlap pair `AI_GATEWAY_PREVIOUS_KEY_ID` and `AI_GATEWAY_PREVIOUS_KEY_SECRET`. Each secret must contain 32–4096 UTF-8 bytes, active and previous identifiers and secrets must be distinct, and all material remains server-only.

Direct `x-workspace-id` and `x-actor-id` headers never authorize a route. Browser cookies, bearer material, client-selected ownership fields, and the HMAC secret must never be forwarded to or exposed by AI service. Missing, malformed, stale, future-dated, method-replayed, path-replayed, or forged context fails closed before the proposal or audit application receives tenant scope.

Decision append accepts a closed JSON body containing `expectedContentDigest`, `idempotencyKey`, `decision`, optional `reason`, and `decidedAt`; actor identity comes only from the verified service context. There is deliberately no apply, execute, command, or user-data mutation route. Proposal generation persists the complete verified audit record before returning the proposal. Validation, not-found, stale-digest, conflicting replay, persistence, and unknown failures are mapped to bounded credential-free problem details.

## Trust boundary

The default LifeOS composition exposes same-origin `/api/ai/...` web routes. That BFF sends the opaque browser cookie only to identity-service `GET /v1/session`, derives `workspaceId` and `userId` from the validated session response, signs the exact AI request, and calls AI service without forwarding the cookie. AI service remains independently deployable behind another compatible private proxy that implements the same versioned contract.

The audit schema stores only validated proposal requests, model identity, inert proposed operations, explanatory rationale, canonical SHA-256 digests, timestamps, and explicit user decisions. It has no foreign key, repository dependency, database privilege, or command surface for planning, calendar, habit, identity, notification, or other user-owned state mutation.

Every proposal, workspace, decision, actor, and idempotency identifier is constrained to UUIDv4. Decision ownership carries `(proposal_id, workspace_id, proposal_content_digest)` through a composite foreign key so an accept/reject event cannot silently target another tenant or a stale proposal revision.

## Integrity and idempotency

`request_digest` is computed from the normalized tenant-scoped proposal request. `content_digest` is computed from immutable proposal provenance and content, including the model identifier, request digest, rationale, proposed operations, confirmation requirement, and proposal creation timestamp. The repository recomputes and verifies both digests on every read.

Decision commands are idempotent by `(workspace_id, proposal_id, idempotency_key)`. Exact replays return the original event. Reuse with another digest, actor, decision, reason, or decision timestamp is rejected. A decision whose expected content digest is not the persisted proposal revision fails closed.

## Runtime privileges

The application runtime role should receive only `SELECT` and `INSERT` on `ai.proposal_audit_records` and `ai.proposal_decision_events`, plus sequence privileges if a future migration introduces sequences. Do not grant `UPDATE`, `DELETE`, or `TRUNCATE` on either table.

Database triggers reject `UPDATE`, `DELETE`, and `TRUNCATE` even for overly broad roles. A separately authorized, audited data-rights erasure migration is required before production account deletion is enabled; application code must not bypass the append-only audit ledger.

## Integration-test safety

Destructive schema setup is permitted only through `AI_TEST_DATABASE_URL`. The URL must use PostgreSQL and its database name must contain `test`; otherwise the integration suite fails closed before opening an administrative pool. The suite temporarily points the application runtime at that disposable database and restores the original `AI_DATABASE_URL` after cleanup. Never set `AI_TEST_DATABASE_URL` to a shared development, staging, or production database.

## Validation evidence

CI supplies separate application and disposable-test variables, applies the migration to an ephemeral PostgreSQL service, and verifies restart durability, deterministic reads, tenant isolation, exact decision replay, stale-digest rejection, conflicting replay rejection, append-only enforcement, bounded runtime configuration, retryable exactly-once successful shutdown, idle-client error handling, unsigned ownership rejection, method/path replay rejection, explicit model selection, bounded external transport, sanitized failures, and the absence of proposal execution routes. All SQL values are parameterized and stored JSON is treated as untrusted evidence on read.

## Secret rotation and rollback

LifeOS supports one active signing key and one bounded previous verification key. Follow `docs/operations/ai-gateway-key-rotation.md` to expand verifier configuration, switch the signer, retain the former active key only through the request-validity and deployment overlap window, and retire it by removing the previous pair. Unknown and retired identifiers fail closed immediately; the verifier never trials every configured secret. If signer and verifier become incompatible, disable external AI proposal traffic rather than falling back to unsigned ownership headers. Suspected compromise requires immediate revocation rather than a normal overlap.

The contextual-orchestrator token has a separate lifecycle from gateway signing keys. Revoke and replace it at the orchestrator boundary. To stop external generation, explicitly redeploy with `AI_PROPOSAL_MODEL=rule-based`; existing audit records retain their original model identifiers and content digests.

The database migration is forward-only in automated environments. An operator-approved rollback must export and verify proposal and decision evidence before dropping `ai.proposal_decision_events`, `ai.proposal_audit_records`, `ai.reject_proposal_audit_mutation()`, and the `ai` schema. Do not roll back after recording production decisions unless legal, retention, and audit requirements have been reviewed and documented.

## Deferred work

Prompt and context redaction, policy evaluation, model-quality and fairness evaluation, asymmetric workload identity, live NVIDIA NIM conformance testing, and separately authorized action execution remain independent reviewed capabilities. The audit service must not gain planning, calendar, habit, identity, notification, or generic command dependencies when those slices are added.
