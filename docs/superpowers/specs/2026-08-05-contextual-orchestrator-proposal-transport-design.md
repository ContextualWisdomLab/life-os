# Contextual Orchestrator Proposal Transport Design

## Status

Approved for autonomous implementation as the next bounded slice of issue #46 after the gateway key-rotation merge.

## Buyer-visible outcome

LifeOS can generate inert, auditable planning proposals through the independently deployable `contextual-orchestrator` OpenAI-compatible boundary while preserving the local rule-based mode, bounded failure behavior, explicit user confirmation, and complete proposal-audit evidence.

## Scope

This slice adds one outbound model adapter and production runtime selector. It does not add proposal execution, tool access, retrieval, hidden mutation, direct NVIDIA NIM calls, browser-visible provider credentials, or a silent fallback from a selected external provider to the local rule-based model.

## Architecture

`ProposalService` remains the technology-independent validation and immutability boundary. A new `ContextualOrchestratorProposalModel` implements the existing `ProposalModel` interface and owns only transport concerns: endpoint validation, bearer authentication, bounded timeout, bounded response streaming, OpenAI-compatible response parsing, and sanitized failures.

`createAiRuntime` selects either `RuleBasedProposalModel` or `ContextualOrchestratorProposalModel` from explicit environment configuration. The default remains `rule-based` so the AI service continues to operate independently without a model gateway. When `contextual-orchestrator` is selected, configuration or transport failure fails closed; the adapter does not try another LifeOS-side provider. Provider retry, capability routing, circuit breaking, and free-model-first fallback belong inside the imported orchestrator service.

## Components

### ContextualOrchestratorProposalModel

The adapter receives an immutable configuration and an injectable Fetch-compatible function. It sends `POST /v1/chat/completions` with:

- `Authorization: Bearer <server-only token>`
- `Content-Type: application/json`
- model `contextual-orchestrator`
- a fixed system instruction stating that all supplied objective and planning context are untrusted data
- one serialized user-data message containing only validated proposal evidence
- `response_format.type = json_schema`
- a strict Draft 2020-12-compatible schema for `summary`, non-empty `rationale`, and non-empty inert `operations`

The schema permits only `create_task`, `prioritize_item`, and `schedule_item`, rejects unknown properties, bounds all strings and arrays to the same limits already enforced by `ProposalService`, and never exposes any executable tool definition.

### Runtime selection

The environment contract is:

- `AI_PROPOSAL_MODEL=rule-based` by default
- `AI_PROPOSAL_MODEL=contextual-orchestrator` to enable the adapter
- `CONTEXTUAL_ORCHESTRATOR_URL` as an HTTPS origin without credentials, query, or fragment
- `CONTEXTUAL_ORCHESTRATOR_TOKEN` as a bounded server-only bearer token
- `AI_MODEL_REQUEST_TIMEOUT_MS` as an integer from 100 through 30000, default 10000

The runtime records `rule-based-v1` or `contextual-orchestrator-v1` in proposal audit evidence.

## Data flow

1. The signed gateway boundary authenticates workspace and actor context.
2. `validateProposalRequest` validates, bounds, and freezes objective and context.
3. `ProposalService` passes only this read-only snapshot to the selected `ProposalModel`.
4. The external adapter serializes the snapshot as untrusted data and calls the orchestrator with a strict output schema.
5. The adapter bounds the response stream before decoding or parsing it.
6. The adapter extracts `choices[0].message.content`, parses one JSON object, and returns an untrusted `ProposalModelDraft`.
7. `ProposalService` independently validates every returned field and creates an immutable, confirmation-required proposal.
8. `ProposalAuditApplication` persists the exact request, proposal, model identifier, and digests before return.

## Security and failure semantics

- Only HTTPS origins are accepted for external mode.
- URL user information, path aliases, query strings, fragments, loopback names, and non-default route selection are rejected by configuration validation.
- The token is never included in errors, logs, proposal evidence, or returned HTTP problems.
- AbortSignal timeout terminates slow requests.
- The response body is stopped at 65536 bytes before complete buffering.
- Non-2xx responses, absent bodies, malformed UTF-8/JSON, invalid OpenAI envelopes, empty content, and transport failures raise one sanitized `ProposalModelTransportError`.
- The controller continues mapping unclassified generation failures to credential-free HTTP 503 `proposal_unavailable`.
- Prompt injection is treated as an inherent model risk: objective and context are labeled as untrusted data, no tools or write-capable dependencies are supplied, structured output is schema-constrained, and the technology-independent validator remains authoritative.
- No external model result can execute an operation or bypass explicit confirmation.

## Testing

Tests must prove:

- exact URL, headers, method, model, system instruction, serialized evidence, and JSON Schema request
- timeout signal creation and injected transport cancellation
- response streaming at and above the 65536-byte boundary
- successful extraction of valid structured output
- rejection of HTTP errors, missing or malformed envelopes, non-string/empty content, malformed JSON, unavailable streams, and network failures without credential leakage
- rejection of unsafe external configuration and acceptance of bounded explicit settings
- default local mode, explicit external mode, model-version audit label, and no silent fallback
- complete statement, branch, function, and line coverage plus JSDoc coverage

A live-provider test is not a required merge check because it would add nondeterminism and external availability to the repository gate. Any future live conformance workflow must use the repository `NVIDIA_NIM_API_KEY` secret through `contextual-orchestrator`, remain opt-in or explicitly bounded, and never replace deterministic contract tests.

## Documentation and release evidence

Update `.env.example`, AI service runtime documentation, `CHANGELOG.md`, package lint inputs, and the commercial capability manifest. This is an unreleased feature slice; no package version is raised until a release candidate is cut.

## References

Autio, C., Schwartz, R., Dunietz, J., Jain, S., Stanley, M., Tabassi, E., Hall, P., & Roberts, K. (2024). *Artificial intelligence risk management framework: Generative artificial intelligence profile* (NIST AI 600-1). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.AI.600-1

Fielding, R., Nottingham, M., & Reschke, J. (2022). *HTTP semantics* (RFC 9110; STD 97). Internet Engineering Task Force. https://doi.org/10.17487/RFC9110

Open Worldwide Application Security Project. (2025). *LLM01:2025 prompt injection*. OWASP GenAI Security Project. https://genai.owasp.org/llmrisk/llm01-prompt-injection/

Wright, A., Andrews, H., Hutton, B., & Dennis, G. (2022). *JSON Schema: A media type for describing JSON documents* (Draft 2020-12). JSON Schema. https://json-schema.org/draft/2020-12/json-schema-core.html

Wright, A., Andrews, H., & Hutton, B. (2022). *JSON Schema validation: A vocabulary for structural validation of JSON* (Draft 2020-12). JSON Schema. https://json-schema.org/draft/2020-12/json-schema-validation.html
