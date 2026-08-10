# LifeOS Standards and Research Traceability

**Status:** Implemented on active PR

This document records normative/current standards and repository-wide research used for durable LifeOS decisions. Drafts and preprints are labeled explicitly and do not silently replace published standards or peer-reviewed evidence.

## Standards matrix

| Source | Publication status | LifeOS use |
| --- | --- | --- |
| IETF RFC 9562, *Universally Unique IDentifiers (UUIDs)* | Final RFC, 2024 | UUIDv4 identifier syntax/semantics; LifeOS intentionally chooses version 4 rather than version 7 |
| IETF RFC 9700 / BCP 240, *Best Current Practice for OAuth 2.0 Security* | Final BCP, January 2025 | OAuth redirect/state/PKCE/token security posture and deprecation of unsafe legacy patterns |
| W3C, *Web Content Accessibility Guidelines (WCAG) 2.2* | W3C Recommendation, 2023 | keyboard/focus/status/authentication accessibility and browser acceptance expectations |
| NIST SP 800-218, *Secure Software Development Framework (SSDF) Version 1.1* | Final, 2022 | secure-development, provenance and vulnerability-prevention practices |
| NIST SP 800-218 Rev. 1 / SSDF 1.2 | Initial Public Draft | watch item only until final publication; does not replace 1.1 requirements |
| NIST AI 100-1, *Artificial Intelligence Risk Management Framework 1.0* | Final, 2023 | AI governance/evidence/risk framing |
| NIST AI 600-1, *AI RMF: Generative Artificial Intelligence Profile* | Final, 2024 | GenAI prompt/provider/evidence risk controls |

## Repository-wide model-orchestration research matrix

| Source | Publication status | LifeOS use |
| --- | --- | --- |
| Sakana AI, *Sakana Fugu: One model to command them all* | Final product release and technical release evidence, 2026 | motivates measuring direct-route versus coordinated-expert execution rather than assuming one topology |
| Nielsen et al., *Learning to orchestrate agents in natural language with the Conductor* | Peer-reviewed ICLR 2026 conference paper | motivates explicit communication topology, targeted instructions, recursive selection and test-time-scaling evidence |
| Xu et al., *TRINITY: An evolved LLM coordinator* | Peer-reviewed ICLR 2026 conference paper | motivates explicit Thinker/Worker/Verifier roles and multi-turn coordination evidence |
| Xu et al., *Rethinking the value of multi-agent workflow: A strong single agent baseline* | arXiv preprint; submitted to ICLR 2026 | counterevidence requiring a strong single-agent baseline before claiming value from homogeneous multi-agent workflows |
| NVIDIA, *API reference—NVIDIA NIM for large language models* | Published primary vendor API documentation, 2026 | authoritative provider transport/API reference for the bounded live-conformance integration |

These sources motivate the dimensions measured by LifeOS; they do **not** establish universal multi-agent superiority. ADR 0012 makes a repository-specific decision: a strong single-model route is the mandatory comparison baseline, deeper orchestration is admitted only from retained LifeOS evidence under reasonably comparable budgets, and deterministic LifeOS authorization/evaluation/review/merge/release authority remains separate from model execution.

## Decision traceability

- **UUIDv4 invariant:** RFC 9562 permits UUID version 4 and defines modern UUID representation; LifeOS's choice of opaque random UUIDv4 is a repository architecture decision, not a claim that v4 is universally superior.
- **OAuth security:** identity and future calendar authorization flows apply current OAuth security best current practice. Issue #129 must use provider-appropriate state/PKCE/redirect and credential lifecycle controls rather than copying browser-login credentials into calendar authority.
- **Accessibility:** core PWA journeys target WCAG 2.2-relevant keyboard/focus/non-color-only/status/authentication behavior with browser acceptance evidence.
- **Secure SDLC:** exact-head CI/security evidence, immutable action pins, least privilege, bounded untrusted input and provenance align with SSDF practices. SSDF 1.2 remains draft as of this baseline.
- **AI governance:** model output remains untrusted and inert, deterministic authorization/validation is separate, provider availability is not fabricated as merge success, and retained artifacts exclude secrets/raw prompts/responses/hidden reasoning.
- **Test-time compute:** ADR 0012 and `docs/superpowers/specs/2026-08-06-ai-nim-live-conformance-design.md` define the strong-route baseline, route/conduct cells, explicit reasoning/stage/decomposition/recursion/access-topology dimensions, unsupported-state handling, `NVIDIA_NIM_API_KEY` credential boundary and independent governance authority.

## Research traceability

Feature-specific peer-reviewed and technical research remains in `docs/research/` and approved `docs/superpowers/specs/` documents. When a research result becomes a repository-wide architectural requirement, an ADR links the primary source, assumptions, alternatives and executable acceptance evidence. Detailed Fugu/Conductor/TRINITY/single-agent limitations and the exact live-conformance profile contract remain in `docs/superpowers/specs/2026-08-06-ai-nim-live-conformance-design.md`; this canonical file records only the repository-wide decision anchors and publication status.

## APA 7 references

Internet Engineering Task Force. (2024). *Universally Unique IDentifiers (UUIDs)* (RFC 9562). RFC Editor. https://doi.org/10.17487/RFC9562

Lodderstedt, T., Bradley, J., Labunets, A., & Fett, D. (2025). *Best current practice for OAuth 2.0 security* (RFC 9700; BCP 240). RFC Editor. https://doi.org/10.17487/RFC9700

National Institute of Standards and Technology. (2022). *Secure Software Development Framework (SSDF) version 1.1: Recommendations for mitigating the risk of software vulnerabilities* (NIST SP 800-218). https://doi.org/10.6028/NIST.SP.800-218

National Institute of Standards and Technology. (2023). *Artificial Intelligence Risk Management Framework (AI RMF 1.0)* (NIST AI 100-1). https://doi.org/10.6028/NIST.AI.100-1

National Institute of Standards and Technology. (2024). *Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile* (NIST AI 600-1). https://doi.org/10.6028/NIST.AI.600-1

Nielsen, S., Cetin, E., Schwendeman, P., Sun, Q., Xu, J., & Tang, Y. (2026). *Learning to orchestrate agents in natural language with the Conductor* [Conference paper]. International Conference on Learning Representations. https://openreview.net/pdf/4a133f1e2ca67ceaedb45c3a123cc8125c694ff5.pdf

NVIDIA Corporation. (2026). *API reference—NVIDIA NIM for large language models*. https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html

Sakana AI. (2026, June 22). *Sakana Fugu: One model to command them all* [Final product release]. https://sakana.ai/fugu-release/

World Wide Web Consortium. (2023). *Web Content Accessibility Guidelines (WCAG) 2.2*. https://www.w3.org/TR/WCAG22/

Xu, J., Koesdwiady, A., Bei, S., Han, Y., Huang, B., Wang, D., Chen, Y., Wang, Z., Wang, P., Li, P., & Ding, Y. (2026). *Rethinking the value of multi-agent workflow: A strong single agent baseline* [Preprint; submitted to ICLR 2026]. arXiv. https://doi.org/10.48550/arXiv.2601.12307

Xu, J., Sun, Q., Schwendeman, P., Nielsen, S., Cetin, E., & Tang, Y. (2026). *TRINITY: An evolved LLM coordinator* [Conference paper]. International Conference on Learning Representations. https://doi.org/10.48550/arXiv.2512.04695
