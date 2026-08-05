# Contextual orchestrator proposal transport

## Purpose

The AI service can use the independently deployable `ContextualWisdomLab/contextual-orchestrator` service as an OpenAI-compatible proposal model while retaining a local deterministic mode. Both modes return only inert proposal drafts. LifeOS validates, persists, and exposes the resulting proposal evidence; neither mode can execute an operation.

## Runtime modes

### Independent local mode

```dotenv
AI_PROPOSAL_MODEL=rule-based
```

`rule-based` is the default when `AI_PROPOSAL_MODEL` is absent or empty. The AI service requires no model gateway in this mode and records `rule-based-v1` in proposal audit evidence.

### Contextual orchestrator mode

```dotenv
AI_PROPOSAL_MODEL=contextual-orchestrator
CONTEXTUAL_ORCHESTRATOR_URL=https://orchestrator.example.com
CONTEXTUAL_ORCHESTRATOR_TOKEN=<32-to-4096-byte-server-token>
AI_MODEL_REQUEST_TIMEOUT_MS=10000
```

The URL must be one exact HTTPS origin with no credentials, path, query, fragment, or loopback hostname. The token must be server-only, contain 32 through 4096 UTF-8 bytes, and contain no carriage return, line feed, or NUL. The timeout must be an integer from 100 through 30000 milliseconds.

LifeOS calls only:

```text
POST /v1/chat/completions
```

The bearer token is sent only to the configured orchestrator origin. It is never returned in proposal evidence, problem responses, or logs.

## Deployment topology

Recommended production topology:

```text
browser
  -> LifeOS web BFF
  -> signed AI service boundary
  -> LifeOS AI service
  -> contextual-orchestrator
  -> orchestrator-governed model pool
```

The AI service and contextual orchestrator remain separately deployable MSA components. A compatible installation may run them in separate clusters or accounts as long as the HTTPS origin, network policy, workload identity, and bearer secret are managed by the operator.

The orchestrator owns provider routing, retries, circuit breaking, spend controls, and free-model-first fallback. LifeOS does not duplicate those policies. After external mode is selected, a transport or provider failure returns a bounded 503 rather than silently switching to the local rule-based model. This preserves audit provenance and prevents an operator-selected model policy from being bypassed.

## Request boundary

LifeOS sends:

- one fixed system instruction
- the validated objective and planning context serialized as untrusted user data
- model `contextual-orchestrator`
- temperature `0`
- streaming disabled
- no tools or function definitions
- a strict JSON Schema response format

The model may propose only:

- `create_task`
- `prioritize_item`
- `schedule_item`

Every output still passes the independent `ProposalService` validator. Unknown properties, empty or oversized text, unsupported operation kinds, malformed UUIDv4 targets, excessive arrays, invalid timestamps, and invalid identifiers fail closed. A successful proposal always carries `requiresConfirmation: true` and is persisted before return.

## Resource bounds

- outbound timeout: default 10000 milliseconds; hard maximum 30000
- response body: hard maximum 65536 bytes before complete buffering
- response decoding: fatal UTF-8
- completion envelope: one non-empty string at `choices[0].message.content`
- structured content: one JSON object subsequently validated by LifeOS

Non-2xx status, missing response body, timeout, network failure, oversized body, invalid UTF-8, malformed JSON, invalid completion envelope, or empty content becomes one sanitized model transport failure. Upstream status text and response bodies are not logged or returned.

## Staged enablement

1. Deploy and verify contextual-orchestrator with its own provider pool, credential registry, allowlist, fallback policy, and health evidence.
2. Create a dedicated inference token. Do not reuse an administrator token.
3. Permit AI service egress only to the orchestrator origin and port.
4. Add the external variables to one non-production AI service deployment.
5. Generate proposals with normal, empty-context, long-text, Korean, and prompt-injection-shaped objectives.
6. Verify every result is inert, schema-valid, persisted with `contextual-orchestrator-v1`, and requires confirmation.
7. Verify orchestrator provider failover and LifeOS 503 behavior separately.
8. Promote the same configuration through the normal release path.

## Rollback

Set:

```dotenv
AI_PROPOSAL_MODEL=rule-based
```

and redeploy the AI service. Existing proposal audit records retain their original model identifiers and digests. Do not rewrite historical records. Remove the external token from the AI service only after all external-mode instances have stopped using it.

Rollback changes future proposal generation only. It does not execute, delete, or modify prior proposals or decisions.

## Incident response

### Token suspected compromised

1. Revoke the orchestrator inference token immediately.
2. Disable external proposal traffic or switch to rule-based mode.
3. Search orchestrator access and audit evidence by token identity, request time, and calling workload.
4. Issue a new dedicated inference token and redeploy through the normal secret path.
5. Do not copy upstream request or response bodies into incident tickets without data classification review.

### Prompt injection or unsafe proposal observed

1. Preserve the immutable LifeOS proposal audit record and orchestrator trace identifier when available.
2. Confirm no operation executed; this transport exposes no tool or command boundary.
3. Reproduce with a sanitized fixture through deterministic evaluation or an approved NVIDIA NIM-backed evaluation workflow.
4. Update orchestrator policy, model pool, prompt boundary, or LifeOS validation as appropriate.
5. Add a regression test before re-enabling affected traffic.

### Repeated timeout or provider failure

Inspect contextual-orchestrator provider health, circuit-breaker state, fallback trace, and spend/budget controls. LifeOS intentionally does not infer which provider failed and does not expose upstream details. Increase the timeout only within the 30000 millisecond hard maximum and only after measuring user-facing latency impact.

## Deterministic verification

```bash
pnpm --filter @life-os/ai-service lint
pnpm --filter @life-os/ai-service typecheck
pnpm --filter @life-os/ai-service test
pnpm --filter @life-os/ai-service build
```

The required repository gate uses injected Fetch responses and does not depend on external model availability. A future live conformance workflow must call contextual-orchestrator with `NVIDIA_NIM_API_KEY` in its provider configuration, must not expose the key to LifeOS application code, and must remain separate from the deterministic unit gate unless bounded reliability has been demonstrated.
