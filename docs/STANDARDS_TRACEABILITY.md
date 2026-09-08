# LifeOS Standards and Research Traceability

**Status:** Implemented on active PR

This document records normative/current standards and repository-wide research used for durable LifeOS decisions. Drafts, preprints, vendor claims, and product-release evidence are labeled explicitly and do not silently replace final standards or peer-reviewed evidence. Publication status below was refreshed against primary sources in September 2026.

## Standards matrix

| Source | Publication status | LifeOS use |
| --- | --- | --- |
| IETF RFC 9562, *Universally Unique IDentifiers (UUIDs)* | Final RFC, 2024 | UUIDv4 identifier syntax/semantics; LifeOS intentionally chooses version 4 rather than version 7 |
| IETF RFC 9700 / BCP 240, *Best Current Practice for OAuth 2.0 Security* | Final Best Current Practice, January 2025 | exact redirect matching, state/PKCE/token and mix-up/open-redirect security posture; unsafe legacy patterns are not copied into Calendar authority |
| W3C, *Web Content Accessibility Guidelines (WCAG) 2.2* | W3C Recommendation, latest Recommendation revision December 2024 | keyboard/focus/status/authentication accessibility and browser acceptance expectations |
| ISO/IEC 40500:2025, *W3C Web Content Accessibility Guidelines (WCAG) 2.2* | Published international standard, October 2025; identical to the October 2023 WCAG 2.2 text | international-standard traceability for the material UI acceptance baseline; W3C's later WCAG 2.2 Recommendation remains the current web-standard reference |
| PostgreSQL 18, §13.2 *Transaction Isolation* | Current supported PostgreSQL major-version documentation; 18.6 is the current minor release as of August 13, 2026 | Read Committed command-snapshot semantics; `ON CONFLICT DO NOTHING` can suppress an insert because of a concurrent winner not visible to that statement snapshot, so exact replay requiring the winner uses a subsequent bounded read rather than same-statement visibility assumptions |
| NIST SP 800-218, *Secure Software Development Framework (SSDF) Version 1.1* | Final, 2022 | secure-development, provenance and vulnerability-prevention practices |
| NIST SP 800-218 Rev. 1 / SSDF Version 1.2 | Initial Public Draft published December 17, 2025; public comment closed January 30, 2026; not final as of the September 2026 verification | watch item only; does not replace SSDF 1.1 normative use until NIST publishes a final revision |
| NIST AI 100-1, *Artificial Intelligence Risk Management Framework 1.0* | Final, 2023 | AI governance/evidence/risk framing |
| NIST AI 600-1, *AI RMF: Generative Artificial Intelligence Profile* | Final, 2024 | GenAI prompt/provider/evidence risk controls |

## Repository-wide model-orchestration research matrix

| Source | Publication status | LifeOS use |
| --- | --- | --- |
| Sakana AI, *Sakana Fugu: One model to command them all* | Primary vendor product/technical release, June 22, 2026; Fugu-Ultra v1.1 product update July 24, 2026 | motivates measuring direct-route versus dynamically coordinated expert execution rather than assuming one topology; vendor benchmark claims are not independent research evidence |
| Nielsen et al., *Learning to orchestrate agents in natural language with the Conductor* | Reported by Sakana AI as an ICLR 2026 paper in its June 2026 Fugu release | motivates explicit communication topology, targeted instructions, recursive selection and test-time-scaling evidence |
| Xu et al., *TRINITY: An evolved LLM coordinator* | Reported by Sakana AI as an ICLR 2026 paper in its June 2026 Fugu release | motivates explicit Thinker/Worker/Verifier roles and multi-turn coordination evidence |
| Xu et al., *Rethinking the value of multi-agent workflow: A strong single agent baseline* | arXiv preprint / conference-submission evidence in the repository bibliography; no final publication status is inferred here | counterevidence requiring a strong single-agent baseline before claiming value from homogeneous multi-agent workflows |

These sources motivate the dimensions measured by LifeOS; they do **not** establish universal multi-agent superiority. ADR 0012 makes a repository-specific decision: a strong single-model route is the mandatory comparison baseline, deeper orchestration is admitted only from retained LifeOS evidence under reasonably comparable budgets, and deterministic LifeOS authorization/evaluation/review/merge/release authority remains separate from model execution.

The runtime/provider implementation boundary is independently governed by the canonical `contextual-orchestrator` owner. LifeOS does not use the presence of any provider-specific research or benchmark as authority to seed provider credentials, choose provider/model/group names, or bypass the released gateway contract. Active PR #208 consumes the owner through virtual `orchestrator/free`; provider and multimodal capability discovery remain owner-side.

## Decision traceability

- **UUIDv4 invariant:** RFC 9562 permits UUID version 4 and defines modern UUID representation; LifeOS's choice of opaque random UUIDv4 is a repository architecture decision, not a claim that v4 is universally superior.
- **OAuth security:** RFC 9700 remains BCP 240 and requires exact registered redirect matching for redirect-based flows (with its documented native-localhost exception) and rejects unsafe open redirectors. Identity and active Calendar OAuth work bind state/PKCE/redirect/provider/user/workspace evidence accordingly. Issue #129 must not copy browser-login credentials or deployment-global provider credentials into end-user Calendar authority.
- **Accessibility:** material PWA journeys target current WCAG 2.2 keyboard/focus/non-color-only/status/authentication requirements. ISO/IEC 40500:2025 adds international-standard traceability but does not justify pinning LifeOS to the older October 2023 text when W3C publishes a newer WCAG 2.2 Recommendation revision.
- **PostgreSQL replay concurrency:** PostgreSQL's current Read Committed documentation explicitly distinguishes statement snapshots and notes that `INSERT ... ON CONFLICT DO NOTHING` can decline an insert because of a concurrent transaction whose effects are not visible to that INSERT snapshot. Active #252 therefore does not assume a same-statement fallback SELECT can always observe the exact idempotency winner; after a no-row conflict it performs a second exact-scope command and validates the returned durable evidence fail closed.
- **Secure SDLC:** exact-head CI/security evidence, immutable action pins, least privilege, bounded untrusted input, provenance and root-cause remediation align with final SSDF 1.1. SSDF 1.2 remains an Initial Public Draft at the latest primary-source verification and therefore remains a watch item.
- **AI governance:** model output remains untrusted and inert, deterministic authorization/validation is separate, gateway/provider availability is not fabricated as merge success, and retained artifacts exclude secrets/raw prompts/responses/hidden reasoning.
- **Test-time compute:** ADR 0012 defines the strong-route baseline and explicit reasoning/stage/decomposition/recursion/role/access-topology dimensions. Fugu/Conductor/TRINITY are research/product evidence for orchestration dimensions, not direct runtime dependencies or provider authority.
- **Model runtime ownership:** all LifeOS model-backed automation and product-facing model capability consumes a reviewed immutable contextual-orchestrator API/client/schema. GitHub Actions uses virtual `orchestrator/free` plus gateway authentication only; provider credentials and discovery are canonical-owner concerns.

## Research traceability

Feature-specific peer-reviewed and technical research remains in `docs/research/` and approved `docs/superpowers/specs/` documents. Historical NIM-specific specs/plans describe the evidence available when they were written and are not promoted into current provider-routing authority. When a research result becomes a repository-wide architectural requirement, an ADR links the primary source, assumptions, alternatives and executable acceptance evidence.

Fugu/Conductor/TRINITY/single-agent research remains relevant to TTC ablation design. The live consumer architecture is separately constrained by ADR 0012, current LifeOS contracts, and the released contextual-orchestrator owner boundary. Unsupported orchestration controls remain explicit rather than simulated.

## APA 7 references

Internet Engineering Task Force. (2024). *Universally Unique IDentifiers (UUIDs)* (RFC 9562). RFC Editor. https://doi.org/10.17487/RFC9562

International Organization for Standardization & International Electrotechnical Commission. (2025). *Information technology—W3C Web Content Accessibility Guidelines (WCAG) 2.2* (ISO/IEC 40500:2025). https://www.iso.org/standard/91056.html

Lodderstedt, T., Bradley, J., Labunets, A., & Fett, D. (2025). *Best current practice for OAuth 2.0 security* (RFC 9700; BCP 240). RFC Editor. https://doi.org/10.17487/RFC9700

National Institute of Standards and Technology. (2022). *Secure Software Development Framework (SSDF) version 1.1: Recommendations for mitigating the risk of software vulnerabilities* (NIST SP 800-218). https://doi.org/10.6028/NIST.SP.800-218

National Institute of Standards and Technology. (2025). *Secure Software Development Framework (SSDF) version 1.2: Recommendations for mitigating the risk of software vulnerabilities* (NIST SP 800-218 Rev. 1, Initial Public Draft). https://csrc.nist.gov/pubs/sp/800/218/r1/ipd

National Institute of Standards and Technology. (2023). *Artificial Intelligence Risk Management Framework (AI RMF 1.0)* (NIST AI 100-1). https://doi.org/10.6028/NIST.AI.100-1

National Institute of Standards and Technology. (2024). *Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile* (NIST AI 600-1). https://doi.org/10.6028/NIST.AI.600-1

Nielsen, S., Cetin, E., Schwendeman, P., Sun, Q., Xu, J., & Tang, Y. (2026). *Learning to orchestrate agents in natural language with the Conductor* [ICLR 2026 paper]. https://arxiv.org/abs/2512.04388

PostgreSQL Global Development Group. (2026). *PostgreSQL 18 documentation: Transaction isolation*. https://www.postgresql.org/docs/18/transaction-iso.html

PostgreSQL Global Development Group. (2026, August 13). *PostgreSQL 18.6, 17.11, 16.15, 15.19, 14.24 and 19 Beta 3 released!*. https://www.postgresql.org/about/news/postgresql-186-1711-1615-1519-1424-and-19-beta-3-released/

Sakana AI. (2026, June 22). *Sakana Fugu: One model to command them all* [Product and technical release]. https://sakana.ai/fugu-release/

Sakana AI. (2026, July 24). *Announcing Fugu-Ultra v1.1 and Claude Code interface for Fugu* [Product release update]. https://sakana.ai/fugu-1-1-claude-code-interface/

World Wide Web Consortium. (2024, December 12). *Web Content Accessibility Guidelines (WCAG) 2.2* [W3C Recommendation]. https://www.w3.org/TR/WCAG22/

World Wide Web Consortium. (2025, October 21). *Web Content Accessibility Guidelines 2.2 approved as ISO/IEC international standard*. https://www.w3.org/press-releases/2025/wcag22-iso-pas/

Xu, J., Koesdwiady, A., Bei, S., Han, Y., Huang, B., Wang, D., Chen, Y., Wang, Z., Wang, P., Li, P., & Ding, Y. (2026). *Rethinking the value of multi-agent workflow: A strong single agent baseline* [Preprint]. arXiv. https://doi.org/10.48550/arXiv.2601.12307

Xu, J., Sun, Q., Schwendeman, P., Nielsen, S., Cetin, E., & Tang, Y. (2026). *TRINITY: An evolved LLM coordinator* [ICLR 2026 paper]. https://doi.org/10.48550/arXiv.2512.04695
