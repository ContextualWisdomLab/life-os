# Contextual orchestrator proposal transport: standards and risk basis

## Decision

LifeOS uses `contextual-orchestrator` through a narrow OpenAI-compatible HTTP adapter rather than embedding provider-specific SDKs in the AI proposal domain. The adapter is optional, separately deployable, bounded, and schema-constrained. The local rule-based model remains the independent default. When external mode is selected, LifeOS fails closed instead of silently changing model provenance.

## HTTP boundary

RFC 9110 defines HTTP as a stateless request-response protocol whose semantics are understood from each message. The adapter therefore sends one self-contained `POST /v1/chat/completions` request to one configured origin and interprets success from the response status before parsing the representation. It does not infer state from a connection, retry unsafe requests in LifeOS, accept alternate redirect targets, or expose upstream status text.

The configured endpoint is restricted to an HTTPS origin without user information, path aliases, query, fragment, or loopback hostname. Request cancellation uses a bounded AbortSignal timeout. Response content is read incrementally and rejected after 65536 bytes before complete buffering.

## Structured output

JSON Schema Draft 2020-12 separates the core data model from validation vocabularies. LifeOS sends a strict schema that defines:

- one object with no additional properties
- a bounded non-empty summary
- a bounded non-empty rationale array
- a bounded non-empty operations array
- exactly three inert operation variants
- UUIDv4-shaped target identifiers for operations that require a target

Schema-constrained generation is not treated as authoritative validation. Provider and gateway implementations can vary, and model output remains untrusted. `ProposalService` independently validates exact keys, lengths, operation kinds, UUIDv4 values, arrays, timestamps, and immutability after parsing.

## Generative AI risk management

NIST AI 600-1 extends the AI Risk Management Framework for generative AI and emphasizes lifecycle risk identification, measurement, governance, and management. This slice applies that profile through:

- explicit model provenance in every proposal audit record
- deterministic transport and validation tests
- bounded inputs, outputs, latency, and failure handling
- credential separation and sanitized errors
- no write-capable model dependency
- immutable evidence before return
- explicit user confirmation after generation
- operator-controlled enablement and rollback

This implementation does not claim that a schema, prompt, or gateway makes model output correct, fair, or safe. Model-quality, fairness, policy, red-team, and longitudinal evaluation remain separate governed capabilities.

## Prompt injection

OWASP LLM01:2025 describes direct and indirect prompt injection as attempts to alter model behavior through content that the model processes as instructions. It also notes that architectural agency determines the impact of a successful injection.

LifeOS reduces impact rather than claiming elimination:

1. Objective and planning context are validated and serialized as explicitly untrusted data.
2. The fixed system instruction forbids interpreting those fields as operational instructions.
3. No tools, functions, credentials, command bus, mutation repository, or write-capable service are exposed to the model.
4. The generated object is restricted to inert operation descriptions.
5. LifeOS validates the object independently of the orchestrator and model.
6. Every proposal requires explicit later confirmation and has no execution route in this slice.
7. Immutable audit evidence supports evaluation and incident review.

A prompt injection may still influence summary, rationale, or proposed operations within the accepted schema. The no-tools, no-execution architecture limits that residual risk to reviewable proposal content.

## Orchestration and fallback ownership

`contextual-orchestrator` already owns provider selection, retries, failover, circuit breaking, access lists, cost controls, and OpenAI-compatible response handling. LifeOS imports that capability at the service boundary rather than reimplementing provider logic. This keeps provider policy modular and permits the same orchestrator to serve other ContextualWisdomLab products.

LifeOS intentionally does not fall back to `RuleBasedProposalModel` after external mode has been selected. A hidden local fallback would change model provenance, undermine operator cost and capability policy, and make proposal audit evidence ambiguous. Operators can explicitly roll back the deployment to `rule-based` mode.

## Test strategy

Required merge checks use deterministic injected Fetch responses. They verify request shape, schema, credentials boundary, timeout signal, body cap, UTF-8 and JSON parsing, envelope handling, sanitized failure behavior, runtime selection, and model identifiers. The existing AI-service gate enforces 100% statement, branch, function, and line coverage plus executable JSDoc coverage.

A live model is unsuitable as a mandatory deterministic unit gate because provider availability, capacity, model revisions, and stochastic behavior can change independently of the repository. Future live conformance and quality evaluation should run through contextual-orchestrator using the repository `NVIDIA_NIM_API_KEY` secret, record model and orchestrator versions, use fixed realistic fixtures, and measure schema adherence, operation validity, proposal utility, injection resistance, latency, and cost.

## References

Autio, C., Schwartz, R., Dunietz, J., Jain, S., Stanley, M., Tabassi, E., Hall, P., & Roberts, K. (2024). *Artificial intelligence risk management framework: Generative artificial intelligence profile* (NIST AI 600-1). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.AI.600-1

Fielding, R., Nottingham, M., & Reschke, J. (2022). *HTTP semantics* (RFC 9110; STD 97). Internet Engineering Task Force. https://doi.org/10.17487/RFC9110

Open Worldwide Application Security Project. (2025). *LLM01:2025 prompt injection*. OWASP GenAI Security Project. https://genai.owasp.org/llmrisk/llm01-prompt-injection/

Wright, A., Andrews, H., Hutton, B., & Dennis, G. (2022). *JSON Schema: A media type for describing JSON documents* (Draft 2020-12). JSON Schema. https://json-schema.org/draft/2020-12/json-schema-core.html

Wright, A., Andrews, H., & Hutton, B. (2022). *JSON Schema validation: A vocabulary for structural validation of JSON* (Draft 2020-12). JSON Schema. https://json-schema.org/draft/2020-12/json-schema-validation.html
