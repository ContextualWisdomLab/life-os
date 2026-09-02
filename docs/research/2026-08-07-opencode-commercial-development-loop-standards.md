# OpenCode commercial development loop: standards and research basis

**Reviewed:** 2026-09-03  
**Scope:** Hourly contextual-orchestrator-routed OpenCode development in `ContextualWisdomLab/life-os`

## Evidence-status rule

LifeOS distinguishes normative standards and final vendor documentation from conference papers, research releases, and preprints. Research results motivate hypotheses and ablations; they do not grant repository authority or replace deterministic tests, security review, and exact-head merge gates.

## Normative security and governance basis

### NIST AI RMF and Generative AI Profile

The AI Risk Management Framework organizes governed AI risk work around Govern, Map, Measure, and Manage. The Generative AI Profile extends that framework with risks such as confabulation, information integrity, privacy, human-AI configuration, and value-chain integration. LifeOS maps these concepts into explicit policy, bounded authority, retained measurements, credential-free receipts, and independent deterministic review (National Institute of Standards and Technology, 2023, 2024).

### GitHub Actions hardening

GitHub recommends least-privilege `GITHUB_TOKEN` permissions, immutable third-party action references, protected branches, careful treatment of untrusted input, and separation of trusted and untrusted execution. The OpenCode step therefore receives no GitHub credential, runs against an exact main snapshot, and cannot push. A later deterministic step receives narrowly scoped repository authority only after the diff and base SHA have passed validation (GitHub, 2026a).

A future organization-central wrapper should use a reusable workflow pinned by exact commit SHA. Repository-specific issue, path, prompt, receipt, and merge policy remains inside LifeOS so shared automation cannot silently broaden product authority (GitHub, 2026b).

### OWASP risks for model-assisted software changes

The OWASP Top 10 for LLM Applications identifies prompt injection, sensitive-information disclosure, excessive agency, improper output handling, supply-chain risk, and unbounded consumption as material concerns. LifeOS treats issue text and model output as untrusted, prevents the model from receiving GitHub credentials or upstream provider credentials, validates source output before execution or push, pins OpenCode and immutable dependencies, scopes provider credentials to the contextual-orchestrator gateway process, and enforces file, byte, line, recursion, decomposition, and concurrency limits (OWASP Foundation, 2025).

## OpenCode and contextual-orchestrator boundary

OpenCode exposes a non-interactive `run` command and provider/model configuration. LifeOS uses one exact reviewed `opencode-ai` package version and verifies the installed version and command contract by spawning that binary without `NODE_OPTIONS`, detecting `--pure` in the combined stdout and stderr of `--help`, and validating the reviewed `run --help` contract inside the verifier boundary. Auto-update, sharing, Models.dev refresh, and project-local configuration discovery are disabled; reviewed workspace instruction files are loaded explicitly. The private OpenCode configuration enables only the loopback `contextual_orchestrator_gateway`, registers and whitelists only `orchestrator/free`, and pins primary and small-model work to that virtual route. The model receives a private configuration and source archive without `.git`; Bash is denied by default except for reviewed command patterns, while web-fetch, web-search, and external-directory access are denied. The prompt is attached from a private file instead of carrying issue text in process arguments (Anomaly, 2026).

Provider and model selection are not LifeOS authority. The contextual-orchestrator gateway owns auto-discovery and governed routing for the virtual `orchestrator/free` route. LifeOS may bootstrap the gateway with available `BYTEZ_API_KEY`, `NVIDIA_NIM_API_KEY`, `NVIDIA_NIM_API_KEY_SUB`, `OPENROUTER_API_KEY`, and `OPENAI_API_KEY` credentials, but those credentials are mapped only to the gateway step and must not enter `opencode_model`. OpenCode authenticates only to the loopback gateway with a per-run random token. UID-based `iptables` rules restrict model-phase egress to that loopback boundary. A protected contextual-orchestrator branch head is not sufficient dependency authority: production consumption requires an immutable reviewed release that implements the required gateway-auth bootstrap. Until such a release exists, LifeOS fails closed instead of repinning to mutable upstream source.

NVIDIA NIM remains one possible contextual-orchestrator upstream rather than a LifeOS-selected provider. Its hosted OpenAI-compatible API uses API-key authentication, so any NIM credential remains subject to the same gateway-only secret boundary and deployment operator agreement (NVIDIA Corporation, 2026).

### Docker Compose verification boundary

Docker documents `--file` as the way to select a Compose configuration and `docker compose config` as parsing, resolving, and rendering the resulting application model; `docker compose up --wait` creates services and waits for them to be running or healthy. LifeOS selects the accepted candidate file explicitly and keeps parsing in a trusted step instead of granting Docker authority to `opencode_model`. Actual PostgreSQL query execution, NATS JetStream monitoring, bounded failure logs, and teardown run in ordinary credential-free pull-request CI, where no provider or GitHub write credential is present, container images are digest-pinned, and published development ports bind only to loopback (Docker, Inc., 2026a, 2026b, 2026c).

## Test-time compute allocation

### Strong single-agent baseline

Xu et al. report that a multi-turn single agent can match homogeneous multi-agent workflows in several evaluated settings and can benefit from KV-cache reuse. Because broader orchestration adds coordination and attack surface, LifeOS requires a strong single-route baseline and does not assume that more agents are better (Xu et al., 2026b).

### Fugu

Sakana AI reports a system that dynamically selects between direct answering and an expert team. This supports an explicit routing decision rather than always-on multi-agent execution. LifeOS treats the result as a final research release and measures whether repository-specific issue fixtures justify deeper orchestration (Sakana AI, 2026).

### Conductor

Conductor learns natural-language communication topologies and targeted instructions, including recursive self-selection for dynamic test-time scaling. The final ICLR 2026 conference paper motivates explicit topology, access-list, recursive-depth, and decomposition fields in the LifeOS ablation contract (Nielsen et al., 2026).

### TRINITY

TRINITY reports a lightweight evolved coordinator assigning Thinker, Worker, and Verifier roles across multiple turns. The final ICLR 2026 conference paper motivates role-specific reasoning effort and explicit verification rather than an undifferentiated agent pool (Xu et al., 2026a).

## LifeOS design conclusions

The initial workflow uses the virtual `orchestrator/free` route while keeping repository mutation authority deterministic and outside the model process. Fugu-, Conductor-, or TRINITY-style test-time compute must be treated as an ablation, not a default feature. It may be enabled only when:

1. the same realistic issue fixtures are used for direct-route and orchestrated cells;
2. issue selection, prompt policy, source authority, and diff validation remain deterministic;
3. prompt-injection and sensitive-information tests do not regress;
4. quality or heterogeneous capability improves materially;
5. unsupported profile fields remain explicit rather than simulated;
6. the exact contextual-orchestrator release and dependency hashes are reviewed and immutable;
7. retained artifacts exclude prompt, response, hidden reasoning, source diff, raw gateway/provider diagnostics, and credentials.

Latency and token use are recorded for capacity review but are not elapsed-time termination authority for reasoning, streaming, or tool-call execution. Product correctness, security, auditability, and buyer-visible quality determine routing and administrative timeout policy.

## Limitations

- Vendor documentation describes interfaces, not independent security assurance.
- The initial dry-run fixtures cannot establish general autonomous-development reliability.
- The workflow applies UID-based `iptables` restrictions to `opencode_model`, allowing only the loopback gateway during model execution and denying IPv6, but this is not a general-purpose operating-system sandbox; the model also receives a source archive without `.git` or GitHub credentials.
- Provider-side retention and processing remain subject to the deployment operator's agreement with whichever upstream contextual-orchestrator selects.
- The model cannot discover or authorize new backlog work in this slice; issue eligibility is an explicit reviewed LifeOS policy.
- A draft pull request is evidence for review, not proof of correctness or permission to merge.
- LifeOS cannot claim the gateway authentication path production-ready until an immutable contextual-orchestrator release contains and verifies the required token bootstrap.

## References

Anomaly. (2026). _OpenCode documentation_. https://opencode.ai/docs/

Docker, Inc. (2026a). _docker compose_. https://docs.docker.com/reference/cli/docker/compose/

Docker, Inc. (2026b). _docker compose config_. https://docs.docker.com/reference/cli/docker/compose/config/

Docker, Inc. (2026c). _docker compose up_. https://docs.docker.com/reference/cli/docker/compose/up/

GitHub. (2026a). _Security hardening for GitHub Actions_. https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions

GitHub. (2026b). _Reusing workflows_. https://docs.github.com/en/actions/using-workflows/reusing-workflows

National Institute of Standards and Technology. (2023). _Artificial intelligence risk management framework (AI RMF 1.0)_ (NIST AI 100-1). https://doi.org/10.6028/NIST.AI.100-1

National Institute of Standards and Technology. (2024). _Artificial intelligence risk management framework: Generative artificial intelligence profile_ (NIST AI 600-1). https://doi.org/10.6028/NIST.AI.600-1

Nielsen, S., Cetin, E., Schwendeman, P., Sun, Q., Xu, J., & Tang, Y. (2026). _Learning to orchestrate agents in natural language with the Conductor_ [Conference paper]. International Conference on Learning Representations. https://openreview.net/forum?id=U23A2BUKYt

NVIDIA Corporation. (2026). _API reference—NVIDIA NIM for large language models_. https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html

OWASP Foundation. (2025). _OWASP Top 10 for large language model applications 2025_. https://genai.owasp.org/llm-top-10/

Sakana AI. (2026, June 22). _Sakana Fugu: One model to command them all_ [Final research release]. https://sakana.ai/fugu-release/

Xu, J., Sun, Q., Schwendeman, P., Nielsen, S., Cetin, E., & Tang, Y. (2026a). _TRINITY: An evolved LLM coordinator_ [Conference paper]. International Conference on Learning Representations. https://doi.org/10.48550/arXiv.2512.04695

Xu, J., Koesdwiady, A., Bei, S., Han, Y., Huang, B., Wang, D., Chen, Y., Wang, Z., Wang, P., Li, P., & Ding, Y. (2026b). _Rethinking the value of multi-agent workflow: A strong single agent baseline_ [Preprint]. arXiv. https://doi.org/10.48550/arXiv.2601.12307
