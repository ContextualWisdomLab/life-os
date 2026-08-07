# NVIDIA OpenCode maintenance standards and research traceability

**Date:** 2026-08-07  
**Scope:** Hourly, plan-only repository maintenance planning for LifeOS  
**Decision record:** `docs/superpowers/specs/2026-08-07-opencode-nim-maintenance-loop-design.md`

## Evidence status

This document separates normative or operational guidance from research evidence:

- **Normative and operational sources:** GitHub Actions security guidance, NIST SSDF, NIST AI RMF, OpenCode product documentation, NVIDIA NIM documentation, and OWASP LLM guidance.
- **Peer-reviewed conference papers:** Conductor and TRINITY, published for ICLR 2026.
- **Preprint:** Strong single-agent baseline, used as a caution against assuming that more agents improve quality.
- **Final research release and technical report:** Sakana Fugu, used as evidence for dynamically selecting direct or coordinated execution rather than always invoking a team.

Repository tests and exact-head review gates remain authoritative for LifeOS. No paper or product document by itself proves that the maintenance workflow is safe.

## Traceability matrix

| LifeOS decision | Source basis | Repository control |
| --- | --- | --- |
| Use a restricted primary planning agent | OpenCode documents primary agents, bounded `steps`, and per-tool `allow`, `ask`, and `deny` permissions (OpenCode, 2026a, 2026b). | `.opencode/agents/maintenance-planner.md` denies shell, delegation, external directories, web access, questions, and all edits except one ephemeral JSON path. |
| Load scheduled automation only from reviewed default-branch source | GitHub scheduled workflows use the default branch, and GitHub recommends minimum token permissions and trusted workflow code (GitHub, 2026a, 2026b). | Workflow checks the default branch, uses immutable action pins, and grants read-only GitHub permissions during evidence collection and model execution. |
| Use only the dedicated NVIDIA credential | NVIDIA documents `NVIDIA_API_KEY` as the NIM provider credential and supports OpenAI-compatible model access (NVIDIA Corporation, 2026a, 2026b). | `NVIDIA_NIM_API_KEY` is mapped to `NVIDIA_API_KEY` only for the provider preflight and OpenCode step. `COPILOT_GITHUB_TOKEN` is prohibited by source tests. |
| Treat issue, PR, log, model, and source text as untrusted observations | GitHub warns against injecting untrusted context into privileged workflows; OWASP identifies prompt injection, excessive agency, and improper output handling as central LLM risks (GitHub, 2026a; OWASP Foundation, 2025). | A deterministic compiler accepts normalized facts rather than prose, hashes the contract, and validates exact plan fields before publication. |
| Keep the initial automation plan-only | NIST SSDF calls for protected development environments and verified software; NIST AI RMF emphasizes governed, measured, and managed risk (NIST, 2022, 2023). | The agent cannot execute commands, write source, mutate GitHub, merge, release, change protection, or access credentials. |
| Use a strong single-model route as the baseline | The strong-single-agent study reports that a multi-turn single agent can match homogeneous multi-agent workflows in several evaluated settings (Xu et al., 2026b). | `route_standard` and `route_high` are the default planning profiles. |
| Allocate deeper orchestration only for high-risk evidence | Fugu dynamically selects direct or coordinated execution; Conductor and TRINITY provide evidence for topology, delegation, verification, and role specialization (Nielsen et al., 2026; Sakana AI, 2026; Xu et al., 2026a). | `conduct_bounded` is selected only for security, credential, migration, tenant-boundary, workflow-permission, or destructive-operation risk and fails closed until the exact-pinned orchestrator path is available. |
| Preserve independent review and exact-head merge gates | SSDF and GitHub guidance support independent verification and least privilege (GitHub, 2026a; NIST, 2022). | The workflow cannot approve or merge. CI, AppGuardrail, Semgrep, Security Scan, CodeRabbit, human review, and the deterministic exact-head drain remain separate. |
| Retain only bounded credential-free evidence | OWASP recommends minimizing excessive agency and validating model output; NIST AI RMF requires measured and managed risk (NIST, 2023; OWASP Foundation, 2025). | Only validated contract, plan JSON, and rendered Markdown are uploaded; raw prompts, responses, logs, traces, secrets, and hidden reasoning are excluded. |

## Standards interpretation

### GitHub Actions

The workflow follows these interpretations of GitHub guidance:

1. default to `contents: read` and add no write permission to the model job;
2. pin actions to immutable commit SHAs;
3. keep untrusted issue and PR prose out of shell scripts and model authority;
4. compile the trusted contract before exposing a provider credential;
5. prevent feature-branch workflow code from receiving the scheduled secret;
6. keep merge eligibility in a deterministic separately reviewed component.

### NIST SSDF and AI RMF

The relevant SSDF practices are protected development environments, verification of software before release, and preparation for vulnerability response. The AI RMF functions—Govern, Map, Measure, and Manage—are represented by:

- repository policy and ADRs (**Govern**);
- bounded PR/check/gap evidence (**Map**);
- compute-profile selection and validated plan artifacts (**Measure**);
- fail-closed provider/orchestrator behavior and independent merge gates (**Manage**).

### OWASP LLM risks

The design directly addresses:

- **Prompt injection:** arbitrary repository prose is excluded from task authority;
- **Improper output handling:** exact schema validation precedes artifact publication;
- **Excessive agency:** source edits, shell, subagents, GitHub mutation, merge, and release are denied;
- **Sensitive information disclosure:** secrets, raw logs, prompts, responses, and hidden reasoning are prohibited;
- **Unbounded consumption:** schedule concurrency, agent steps, recursion/decomposition, output bytes, and job duration are bounded.

## Test-time compute interpretation

The source literature does not establish one universally optimal topology. LifeOS therefore uses a deterministic policy:

1. no model call for `wait` or `complete`;
2. `route_standard` for one ordinary check or one bounded gap;
3. `route_high` for coupled packages or multiple ordinary checks;
4. `conduct_bounded` for high-risk security and integrity work;
5. no silent downgrade when the selected orchestrator cannot be established.

Latency and tokens are operational measurements, not the primary quality objective. The workflow records why more compute was selected and requires repository-specific evidence before any future write-capable automation is considered.

## Limitations

- The initial slice does not execute the contextual-orchestrator profile; it produces an explicit unavailable plan for high-risk work.
- OpenCode and NVIDIA provider behavior may evolve. Pins and contract tests must be updated together after source review.
- GitHub's repository token is still present in the runner environment when the OpenCode action uses the built-in token. The model job therefore remains read-only and the agent denies GitHub mutation.
- The commercial-readiness manifest can show all configured capabilities at target while buyers still perceive gaps not yet represented in the manifest. Adding a new capability requires a reviewed product decision.
- Model plans are advisory. They do not replace deterministic tests, security review, or human product judgment.

## References

GitHub. (2026a). _Security hardening for GitHub Actions_. GitHub Docs. https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions

GitHub. (2026b). _Workflow syntax for GitHub Actions_. GitHub Docs. https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions

National Institute of Standards and Technology. (2022). _Secure software development framework (SSDF) version 1.1: Recommendations for mitigating the risk of software vulnerabilities_ (NIST SP 800-218). https://doi.org/10.6028/NIST.SP.800-218

National Institute of Standards and Technology. (2023). _Artificial intelligence risk management framework (AI RMF 1.0)_ (NIST AI 100-1). https://doi.org/10.6028/NIST.AI.100-1

Nielsen, S., Cetin, E., Schwendeman, P., Sun, Q., Xu, J., & Tang, Y. (2026). _Learning to orchestrate agents in natural language with the Conductor_ [Conference paper]. International Conference on Learning Representations. https://openreview.net/forum?id=4a133f1e2ca67ceaedb45c3a123cc8125c694ff5

NVIDIA Corporation. (2026a). _API reference—NVIDIA NIM for large language models_. https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html

NVIDIA Corporation. (2026b). _LLM provider configuration: NVIDIA NIM_. NVIDIA NeMo Agent Toolkit documentation. https://docs.nvidia.com/nemo/agent-toolkit/latest/build-workflows/llms/index.html

OpenCode. (2026a). _Agents_. https://opencode.ai/docs/agents/

OpenCode. (2026b). _Permissions_. https://opencode.ai/docs/permissions/

OpenCode. (2026c). _GitHub_. https://opencode.ai/docs/github/

OWASP Foundation. (2025). _OWASP Top 10 for large language model applications 2025_. https://genai.owasp.org/llm-top-10/

Sakana AI. (2026, June 22). _Sakana Fugu: One model to command them all_. https://sakana.ai/fugu-release/

Xu, J., Koesdwiady, A., Bei, S., Han, Y., Huang, B., Wang, D., Chen, Y., Wang, Z., Wang, P., Li, P., & Ding, Y. (2026b). _Rethinking the value of multi-agent workflow: A strong single agent baseline_ [Preprint]. arXiv. https://doi.org/10.48550/arXiv.2601.12307

Xu, J., Sun, Q., Schwendeman, P., Nielsen, S., Cetin, E., & Tang, Y. (2026a). _TRINITY: An evolved LLM coordinator_ [Conference paper]. International Conference on Learning Representations. https://doi.org/10.48550/arXiv.2512.04695
