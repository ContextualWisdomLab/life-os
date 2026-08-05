# AI proposal quality evaluation: standards and research basis

## Decision

LifeOS evaluates proposal generation as a layered measurement problem rather than equating a successful HTTP call or schema-valid JSON object with a useful result. The deterministic evaluator separates production-validator success, semantic operation conformance, evidence grounding, forbidden-text leakage, benign utility, and prompt-injection resistance.

## Risk-management basis

NIST AI 600-1 frames generative AI risk management across governance, mapping, measurement, and management throughout the lifecycle. The LifeOS evaluator operationalizes a bounded subset of that profile by using versioned realistic fixtures, explicit metrics, immutable evidence, model provenance, reproducible tests, and separate operator interpretation. It does not claim to measure every generative AI risk or replace human governance.

NIST AI 100-2 E2025 provides current adversarial-machine-learning terminology and distinguishes attack goals, capabilities, lifecycle stages, and mitigations. Direct and indirect instruction-like fixture content is therefore treated as adversarial evaluation data. Model failure, malformed output, false refusal, semantic deviation, unsupported targets, and sentinel leakage remain distinct observations rather than one undifferentiated safety score.

## Prompt injection and agency

OWASP LLM01:2025 states that prompt injection occurs when processed input changes model behavior or output in unintended ways and that retrieval or fine-tuning does not fully remove the vulnerability. LifeOS measures both direct objective injection and indirect injection embedded in context evidence.

The evaluator does not claim elimination. Impact is structurally limited because the evaluated model receives no tool definition, credential, command bus, or write-capable dependency; output passes `ProposalService`; operations remain inert; and every proposal still requires confirmation. A fixture can nevertheless fail when injected content changes the proposed operation, target, or reviewable text.

## Safety–utility separation

CyberSecEval 2 evaluates prompt injection and emphasizes the safety–utility tradeoff, including false refusal of benign requests. LifeOS therefore reports `benignUtilityRate` separately from `promptInjectionResistanceRate`. A model that refuses every request cannot receive a perfect utility result merely because it avoids sentinel leakage.

The default suite is intentionally small and product-specific rather than a replacement for a broad cybersecurity benchmark. It provides a release-relevant regression signal at the exact LifeOS proposal boundary.

## Structured output versus semantic correctness

The 2026 Structured Output Benchmark distinguishes schema compliance from the correctness of values extracted into that schema and reports substantial gaps between them. LifeOS preserves the same distinction:

- `validProposalRate` measures compatibility with the production schema and validator.
- `operationConformanceRate` measures whether allowed operation kinds and required targets match the labeled task.
- `targetGroundingRate` measures whether targeted identifiers exist in supplied evidence.

A schema-valid proposal that selects the wrong operation or cites an unsupported identifier is not scored as semantically conformant.

## Structured queries and untrusted data

StruQ separates instructions from untrusted data to reduce prompt-injection risk. The contextual-orchestrator proposal adapter similarly uses one fixed system instruction and serializes validated objective/context evidence as untrusted user data. The evaluator tests this architectural boundary with direct and indirect injection fixtures. Structured separation is one mitigation layer and remains paired with no-tools architecture and independent output validation.

## Measurement properties

### Integer evidence before rates

Every rate derives from explicit integer counts. This makes reports auditable, prevents rounding from hiding small-suite changes, and permits recomputation. Undefined denominators are represented as `null`.

### Versioned fixtures

The suite version changes whenever scenario content or labels change. Model results from different fixture versions are not treated as directly comparable without a bridging analysis.

### Unicode normalization

Forbidden text is compared after NFKC normalization and locale-aware lowercase conversion. This catches harmless compatibility-character variants in evaluation sentinels without claiming general semantic-equivalence detection.

### Immutable reports

Fixtures, case results, counts, rates, and reports are frozen. Nested model errors and response bodies are discarded so the report remains credential-free and bounded.

## Deterministic and live evidence

Deterministic scripted-model tests are the required merge gate because they can prove metric arithmetic, validator integration, grounding logic, failure sanitization, denominator handling, and complete code coverage. External model availability and revisions are not deterministic repository properties.

A later live NVIDIA NIM conformance workflow should reuse the exact evaluator through `contextual-orchestrator`, record all relevant versions, and preserve provider routing and free-model-first fallback inside the orchestrator. Live results are release evidence, not a substitute for deterministic unit and integration checks.

## Limitations

The default suite does not estimate population-level model quality, demographic fairness, calibration, causal impact, longitudinal user outcomes, or every prompt-injection strategy. Its rates have high sampling uncertainty because the suite is deliberately compact and scenario-specific. A future evaluation program should add repeated runs, confidence intervals, broader multilingual and temporal cases, severity-weighted failures, and versioned longitudinal dashboards without weakening the production validation boundary.

## References

Autio, C., Schwartz, R., Dunietz, J., Jain, S., Stanley, M., Tabassi, E., Hall, P., & Roberts, K. (2024). *Artificial intelligence risk management framework: Generative artificial intelligence profile* (NIST AI 600-1). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.AI.600-1

Bhatt, M., Chennabasappa, S., Li, Y., Nikolaidis, C., Song, D., Wan, S., Ahmad, F., Aschermann, C., Chen, Y., Kapil, D., Molnar, D., Whitman, S., & Saxe, J. (2024). CyberSecEval 2: A wide-ranging cybersecurity evaluation suite for large language models. *arXiv*. https://doi.org/10.48550/arXiv.2404.13161

Chen, S., Piet, J., Sitawarin, C., & Wagner, D. (2024). StruQ: Defending against prompt injection with structured queries. *arXiv*. https://doi.org/10.48550/arXiv.2402.06363

Open Worldwide Application Security Project. (2025). *LLM01:2025 prompt injection*. OWASP GenAI Security Project. https://genai.owasp.org/llmrisk/llm01-prompt-injection/

Singh, A. K., Khurdula, H. V., Khemlani, Y. D., & Agarwal, V. (2026). The structured output benchmark: A multi-source benchmark for evaluating structured output quality in large language models. *arXiv*. https://doi.org/10.48550/arXiv.2604.25359

Vassilev, A., Oprea, A., Fordyce, A., Anderson, H., Davies, X., & Hamin, M. (2025). *Adversarial machine learning: A taxonomy and terminology of attacks and mitigations* (NIST AI 100-2 E2025). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.AI.100-2e2025
