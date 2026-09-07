# ADR-0003: Adaptive contextual-orchestrator mode is the proposal default

- Status: Accepted
- Date: 2026-08-16

## Context

LifeOS sent a provider-native JSON Schema response format to contextual-orchestrator. The current gateway deliberately proxies such requests to one worker because multi-agent tool and structured-output envelopes cannot be merged losslessly. Although the request omitted a mode and therefore appeared adaptive, the structured-output trigger made the effective path a fixed single-model passthrough.

LifeOS already treats model output as untrusted. The technology-independent ProposalService validates exact keys, bounded text and arrays, operation kinds, and UUIDv4 targets before an inert proposal can be persisted or returned.

## Decision

Production proposal requests include `orchestration_mode: "auto"` and `include_orchestration_trace: false`, and they do not send provider-native `response_format`.

The fixed system instruction still demands one JSON object. Contextual-orchestrator owns provider/model selection, workflow depth, verification, fallback, and known-price optimization. Quality sufficiency is the first constraint; cost is minimized among execution paths that satisfy it. LifeOS remains the final authority for strict parsing and domain validation and fails closed on malformed output.

The live-conformance harness retains explicit route and conduct profiles because it is an ablation and measurement surface, not the production default.

## Consequences

Simple requests may still use one worker when adaptive policy finds that sufficient. Harder requests may use deeper orchestration. LifeOS no longer gains provider-side schema enforcement, but it does not rely on that enforcement for trust; the existing strict validator remains mandatory and fully tested.

## References

Omidvar, H., & Akhlaghi, V. (2026). *A communication-theoretic framework for LLM agents: Cost-aware adaptive reliability* [Preprint]. arXiv. https://doi.org/10.48550/arXiv.2605.09121

Sakana AI. (2026). *Sakana Fugu technical report* [Technical report; preprint]. arXiv. https://doi.org/10.48550/arXiv.2606.21228
