# AI gateway key rotation design

Issue: #112  
Capability: `ai.auditable-proposals`

## Product outcome

Operators can rotate the private gateway-to-AI-service HMAC credential without rejecting valid in-flight requests during a planned overlap. Every request identifies exactly one configured key; unknown, malformed, incomplete, duplicate, conflicting, or retired key material fails closed.

## Architecture

The private context remains a short-lived method-and-path-bound HMAC envelope. Version 2 adds a bounded key identifier to both the HTTP header set and canonical HMAC input.

```text
browser session
    |
    v
web BFF -- authenticate session + authorize workspace
    |
    | x-life-os-context-key-id: active-key-id
    | x-life-os-workspace-id
    | x-life-os-actor-id
    | x-life-os-context-issued-at
    | x-life-os-context-signature
    v
AI service -- exact key-id lookup --> active OR previous verifier
```

The web BFF receives only the active signing pair. The AI service receives the active pair and optionally one previous verification pair. The verifier never iterates secrets and never treats the identifier as a database, file, network, or secret-manager locator.

## Canonical message

```text
life-os.ai-context.v2
<key-id>
<workspace-id>
<actor-id>
<issued-at-unix-seconds>
<uppercase-method>
<canonical-path>
```

Each line is UTF-8 and separated by one line-feed byte. The signature is HMAC-SHA-256 encoded as canonical unpadded Base64URL.

## Configuration

- `AI_GATEWAY_ACTIVE_KEY_ID`
- `AI_GATEWAY_ACTIVE_KEY_SECRET`
- `AI_GATEWAY_PREVIOUS_KEY_ID` (optional)
- `AI_GATEWAY_PREVIOUS_KEY_SECRET` (optional)

The active pair is mandatory. Previous values are both absent or both present. Active and previous identifiers are case-sensitive and distinct. Identifiers contain 1–64 allowlisted ASCII characters. Secrets contain 32–4096 UTF-8 bytes and no line break or NUL characters.

## Failure mapping

| Condition                                                         | Boundary classification           |
| ----------------------------------------------------------------- | --------------------------------- |
| Missing/malformed/unknown request key identifier                  | `401 invalid_gateway_context`     |
| Signature mismatch, stale context, replayed method/path           | `401 invalid_gateway_context`     |
| Missing, partial, duplicate, or malformed local key configuration | `503 gateway_context_unavailable` |

Responses remain RFC 9457-compatible, credential-free, and stable. Logs record only fixed failure classes and correlation metadata, never key identifiers, signatures, or secrets.

## Rotation state machine

1. **Stable A:** signer A; verifier active A.
2. **Verifier expansion:** signer A; verifier active A, previous B.
3. **Signer switch:** signer B; verifier active B, previous A.
4. **Retirement:** signer B; verifier active B.

Emergency compromise skips bounded overlap for the compromised key and revokes it immediately.

## Quality gates

- key configuration unit tests
- active and previous explicit selection tests
- missing, malformed, duplicate, partial, conflicting, unknown, and retired key tests
- canonical version and field-order tests
- BFF active-only signing tests
- AI controller header and configuration tests
- old-key in-flight overlap and post-retirement rejection integration tests
- no-secret logging and problem-response regressions
- 100% AI-service statement, branch, function, and line coverage
- full repository formatting, lint, type checking, tests, build, Compose validation, security scans, commercial readiness, and review gates
