# LifeOS Standards and Research Traceability

**Status:** Accepted architecture  
**Baseline:** protected `main` at `f4cae6d83eadb00019d2962a650c55c59a3349ae`

## 1. Evidence classes

LifeOS distinguishes:

1. **Normative standard/specification** — protocol, accessibility, identifier or security requirements.
2. **Authoritative guidance** — risk/control guidance that informs product policy but is not itself a protocol.
3. **Peer-reviewed research** — empirical/theoretical evidence for a substantive design or evaluation method.
4. **Preprint/experimental evidence** — useful for exploration, never silently promoted to normative product truth.
5. **Repository evidence** — exact source, migration, test, runbook and current protected-main behavior.

Repository implementation claims require repository evidence even when a standard/research source motivates the design.

## 2. Traceability matrix

| LifeOS decision | Evidence class | Representative source | Repository evidence |
| --- | --- | --- | --- |
| Opaque UUID internal identifiers and explicit UUID version contract | Normative standard | IETF UUID specification family | `ARCHITECTURE.md`, service validators/migrations/tests |
| OAuth state/redirect security and separate recent-auth semantics | Normative/security guidance | OAuth 2.0 protocol + OAuth security best-current-practice family | identity OAuth/session/authentication-age tests |
| PKCE/state for hosted calendar authorization | Normative standard | PKCE / OAuth security guidance | Planned under issue #129; not protected-main completion |
| Accessible core web journeys | Normative standard | W3C WCAG 2.2 | web accessibility tests and localization/browser evidence |
| HTTP problem/error responses remain bounded and non-secret | Normative standard/guidance | IETF Problem Details + secure error-handling practice | service HTTP-boundary tests |
| CloudEvents-style plugin event envelope | Normative specification | CNCF CloudEvents specification | plugin SDK/integration tests |
| AI output remains untrusted/inert with explicit user authority | Authoritative guidance + repository threat model | NIST AI RMF / GenAI risk guidance; OWASP LLM threat guidance where scoped research cites it | AI proposal/audit/quality/prompt-injection tests |
| Prompt/model/provider evidence does not replace deterministic product validation | Authoritative guidance + empirical evaluation | scoped `docs/research/` evidence | deterministic evaluator and bounded live-conformance split |
| Service-owned persistence and least privilege | Architecture/security principle | OWASP/NIST/CNCF guidance as scoped in repository research/runbooks | separate service migrations/roles and architecture tests |
| Data portability/erasure must provide complete auditable outcomes | Legal/privacy engineering requirement | jurisdiction/operator-specific legal basis plus repository privacy model | issue #55 and protected-main data-rights foundation |
| Exact source-head evidence must not be confused with synthetic merge-tree evidence | GitHub/repository governance | GitHub Actions/PR checkout semantics | issue #132 and commercial-readiness gate tests |

## 3. APA 7 reference baseline

The following sources are stable reference anchors. Scoped design/research documents may contain more specific references and publication-status notes.

Davis, K., Peabody, B., & Leach, P. (2024). *Universally unique IDentifiers (UUIDs)* (RFC 9562). Internet Engineering Task Force. https://www.rfc-editor.org/rfc/rfc9562

Hardt, D. (2012). *The OAuth 2.0 authorization framework* (RFC 6749). Internet Engineering Task Force. https://www.rfc-editor.org/rfc/rfc6749

Sakimura, N., Bradley, J., & Agarwal, N. (2015). *Proof key for code exchange by OAuth public clients* (RFC 7636). Internet Engineering Task Force. https://www.rfc-editor.org/rfc/rfc7636

Lodderstedt, T., Bradley, J., Labunets, A., & Fett, D. (2025). *Best current practice for OAuth 2.0 security* (RFC 9700). Internet Engineering Task Force. https://www.rfc-editor.org/rfc/rfc9700

Nottingham, M., Wilde, E., & Dalal, S. (2023). *Problem details for HTTP APIs* (RFC 9457). Internet Engineering Task Force. https://www.rfc-editor.org/rfc/rfc9457

National Institute of Standards and Technology. (2023). *Artificial intelligence risk management framework (AI RMF 1.0)* (NIST AI 100-1). U.S. Department of Commerce. https://doi.org/10.6028/NIST.AI.100-1

National Institute of Standards and Technology. (2024). *Artificial intelligence risk management framework: Generative artificial intelligence profile* (NIST AI 600-1). U.S. Department of Commerce. https://doi.org/10.6028/NIST.AI.600-1

World Wide Web Consortium. (2023). *Web Content Accessibility Guidelines (WCAG) 2.2*. https://www.w3.org/TR/WCAG22/

## 4. Use rule

- A standard citation does not prove LifeOS implements it.
- A repository test does not automatically prove broad conformance beyond the tested scope.
- Research findings are recorded with population/task limitations.
- Preprints and experimental provider results are labeled as such.
- When a substantive architecture decision depends on a source, the corresponding ADR records the source and the executable acceptance evidence.

## 5. Maintenance

When a cited standard is superseded or repository behavior materially changes, update the relevant scoped research note, ADR and this index. Do not silently rewrite historical ADR rationale; add supersession evidence.