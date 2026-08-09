# LifeOS Standards and Research Traceability

**Status:** Implemented on active PR

This document records normative/current standards used for repository-wide decisions. Drafts are tracked as watch items and do not silently replace published requirements.

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

## Decision traceability

- **UUIDv4 invariant:** RFC 9562 permits UUID version 4 and defines modern UUID representation; LifeOS's choice of opaque random UUIDv4 is a repository architecture decision, not a claim that v4 is universally superior.
- **OAuth security:** identity and future calendar authorization flows apply current OAuth security best current practice. Issue #129 must use provider-appropriate state/PKCE/redirect and credential lifecycle controls rather than copying browser-login credentials into calendar authority.
- **Accessibility:** core PWA journeys target WCAG 2.2-relevant keyboard/focus/non-color-only/status/authentication behavior with browser acceptance evidence.
- **Secure SDLC:** exact-head CI/security evidence, immutable action pins, least privilege, bounded untrusted input and provenance align with SSDF practices. SSDF 1.2 remains draft as of this baseline.
- **AI governance:** model output remains untrusted and inert, deterministic authorization/validation is separate, provider availability is not fabricated as merge success, and retained artifacts exclude secrets/raw prompts/responses/hidden reasoning.

## Research traceability

Feature-specific peer-reviewed and technical research remains in `docs/research/` and approved `docs/superpowers/specs/` documents. When a research result becomes a repository-wide architectural requirement, add an ADR linking the primary source, assumptions, alternatives and executable acceptance evidence.

## APA 7 references

Internet Engineering Task Force. (2024). *Universally Unique IDentifiers (UUIDs)* (RFC 9562). RFC Editor. https://doi.org/10.17487/RFC9562

Lodderstedt, T., Bradley, J., Labunets, A., & Fett, D. (2025). *Best current practice for OAuth 2.0 security* (RFC 9700; BCP 240). RFC Editor. https://doi.org/10.17487/RFC9700

National Institute of Standards and Technology. (2022). *Secure Software Development Framework (SSDF) version 1.1: Recommendations for mitigating the risk of software vulnerabilities* (NIST SP 800-218). https://doi.org/10.6028/NIST.SP.800-218

National Institute of Standards and Technology. (2023). *Artificial Intelligence Risk Management Framework (AI RMF 1.0)* (NIST AI 100-1). https://doi.org/10.6028/NIST.AI.100-1

National Institute of Standards and Technology. (2024). *Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile* (NIST AI 600-1). https://doi.org/10.6028/NIST.AI.600-1

World Wide Web Consortium. (2023). *Web Content Accessibility Guidelines (WCAG) 2.2*. https://www.w3.org/TR/WCAG22/
