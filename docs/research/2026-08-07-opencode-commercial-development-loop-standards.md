# OpenCode commercial development loop: standards and research basis

**Reviewed:** 2026-08-07  
**Scope:** Hourly NVIDIA-backed OpenCode development in `ContextualWisdomLab/life-os`

## Evidence-status rule

LifeOS distinguishes normative standards and final vendor documentation from conference papers, research releases, and preprints. Research results motivate hypotheses and ablations; they do not grant repository authority or replace deterministic tests, security review, and exact-head merge gates.

## Normative security and governance basis

### NIST AI RMF and Generative AI Profile

The AI Risk Management Framework organizes governed AI risk work around Govern, Map, Measure, and Manage. The Generative AI Profile extends that framework with risks such as confabulation, information integrity, privacy, human-AI configuration, and value-chain integration. LifeOS maps these concepts into explicit policy, bounded authority, retained measurements, credential-free receipts, and independent deterministic review (National Institute of Standards and Technology, 2023, 2024).

### GitHub Actions hardening

GitHub recommends least-privilege `GITHUB_TOKEN` permissions, immutable third-party action references, protected branches, careful treatment of untrusted input, and separation of trusted and untrusted execution. The OpenCode step therefore receives no GitHub credential, runs against an exact main snapshot, and cannot push. A later deterministic step receives narrowly scoped repository authority only after the diff and base SHA have passed validation (GitHub, 2026a).

A future organization-central wrapper should use a reusable workflow pinned by exact commit SHA. Repository-specific issue, path, prompt, receipt, and merge policy remains inside LifeOS so shared automation cannot silently broaden product authority (GitHub, 2026b).

### OWASP risks for model-assisted software changes

The OWASP Top 10 for LLM Applications identifies prompt injection, sensitive-information disclosure, excessive agency, improper output handling, supply-chain risk, and unbounded consumption as material concerns. LifeOS treats issue text and model output as untrusted, prevents the model from receiving GitHub credentials, validates source output before execution or push, pins OpenCode and GitHub actions, scopes the NVIDIA key to one process, and enforces file, byte, line, time, recursion, decomposition, and concurrency limits (OWASP Foundation, 2025).

## OpenCode and NVIDIA provider boundary

OpenCode exposes a non-interactive `run` command and provider/model configuration. LifeOS uses one exact reviewed `opencode-ai` package version and verifies both the installed version and command contract. Auto-update and sharing are disabled. The model receives a private configuration and a source archive without `.git`; tool permissions deny shell, web-fetch, task delegation, and external-directory access in the initial slice. The prompt is attached from a private file instead of carrying issue text in process arguments (Anomaly, 2026).

NVIDIA NIM exposes hosted OpenAI-compatible inference authenticated with an API key. `NVIDIA_NIM_API_KEY` is mapped only to the OpenCode process under the provider-specific alias expected by the pinned client. The process is launched with an allowlisted minimal environment; GitHub, review-agent, deployment, and unrelated repository credentials are absent. Provider availability is evidence, not a deterministic merge prerequisite (NVIDIA Corporation, 2026).

## Test-time compute allocation

### Strong single-agent baseline

Xu et al. report that a multi-turn single agent can match homogeneous multi-agent workflows in several evaluated settings and can benefit from KV-cache reuse. Because broader orchestration adds coordination and attack surface, LifeOS requires a strong single-model route as the mandatory baseline and does not assume that more agents are better (Xu et al., 2026b).

### Fugu

Sakana AI reports a system that dynamically selects between direct answering and an expert team. This supports an explicit routing decision rather than always-on multi-agent execution. LifeOS treats the result as a final research release and measures whether repository-specific issue fixtures justify deeper orchestration (Sakana AI, 2026).

### Conductor

Conductor learns natural-language communication topologies and targeted instructions, including recursive self-selection for dynamic test-time scaling. The final ICLR 2026 conference paper motivates explicit topology, access-list, recursive-depth, and decomposition fields in the LifeOS ablation contract (Nielsen et al., 2026).

### TRINITY

TRINITY reports a lightweight evolved coordinator assigning Thinker, Worker, and Verifier roles across multiple turns. The final ICLR 2026 conference paper motivates role-specific reasoning effort and explicit verification rather than an undifferentiated agent pool (Xu et al., 2026a).

## LifeOS design conclusions

The initial workflow intentionally runs one high-effort OpenCode model with recursion depth one. It records a versioned contract for planner, worker, verifier, and synthesizer roles but does not enable hidden multi-agent delegation. A contextual-orchestrator profile may be introduced only when:

1. the same realistic issue fixtures are used for route and orchestrated cells;
2. issue selection, prompt policy, source authority, and diff validation remain deterministic;
3. prompt-injection and sensitive-information tests do not regress;
4. quality or heterogeneous capability improves materially;
5. unsupported profile fields remain explicit rather than simulated;
6. the exact contextual-orchestrator commit and dependency hashes are reviewed;
7. retained artifacts exclude prompt, response, hidden reasoning, source diff, and credentials.

Latency and token use are recorded for cost and capacity review but are not the primary optimization objective. Product correctness, security, auditability, and buyer-visible quality determine the routing decision.

## Limitations

- Vendor documentation describes interfaces, not independent security assurance.
- The initial dry-run fixtures cannot establish general autonomous-development reliability.
- The workflow does not provide an operating-system-level network sandbox; the initial OpenCode profile therefore denies shell and web tools and receives a source archive without `.git` or GitHub credentials.
- Provider-side retention and processing remain subject to the deployment operator's NVIDIA agreement and data-governance assessment.
- The model cannot discover or authorize new backlog work in this slice; issue eligibility is an explicit reviewed policy.
- A draft pull request is evidence for review, not proof of correctness or permission to merge.

## References

Anomaly. (2026). *OpenCode documentation*. https://opencode.ai/docs/

GitHub. (2026a). *Security hardening for GitHub Actions*. https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions

GitHub. (2026b). *Reusing workflows*. https://docs.github.com/en/actions/using-workflows/reusing-workflows

National Institute of Standards and Technology. (2023). *Artificial intelligence risk management framework (AI RMF 1.0)* (NIST AI 100-1). https://doi.org/10.6028/NIST.AI.100-1

National Institute of Standards and Technology. (2024). *Artificial intelligence risk management framework: Generative artificial intelligence profile* (NIST AI 600-1). https://doi.org/10.6028/NIST.AI.600-1

Nielsen, S., Cetin, E., Schwendeman, P., Sun, Q., Xu, J., & Tang, Y. (2026). *Learning to orchestrate agents in natural language with the Conductor* [Conference paper]. International Conference on Learning Representations. https://openreview.net/pdf?id=4a133f1e2ca67ceaedb45c3a123cc8125c694ff5

NVIDIA Corporation. (2026). *API reference—NVIDIA NIM for large language models*. https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html

OWASP Foundation. (2025). *OWASP Top 10 for large language model applications 2025*. https://genai.owasp.org/llm-top-10/

Sakana AI. (2026, June 22). *Sakana Fugu: One model to command them all* [Final research release]. https://sakana.ai/fugu-release/

Xu, J., Sun, Q., Schwendeman, P., Nielsen, S., Cetin, E., & Tang, Y. (2026a). *TRINITY: An evolved LLM coordinator* [Conference paper]. International Conference on Learning Representations. https://doi.org/10.48550/arXiv.2512.04695

Xu, J., Koesdwiady, A., Bei, S., Han, Y., Huang, B., Wang, D., Chen, Y., Wang, Z., Wang, P., Li, P., & Ding, Y. (2026b). *Rethinking the value of multi-agent workflow: A strong single agent baseline* [Preprint]. arXiv. https://doi.org/10.48550/arXiv.2601.12307
