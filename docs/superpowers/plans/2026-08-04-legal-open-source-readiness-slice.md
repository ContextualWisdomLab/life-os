# Legal open-source readiness slice

## Objective

Make the upstream LifeOS distribution legible to users, contributors, operators, and prospective acquirers without pretending that the upstream project is the controller or service provider for independent self-hosted deployments.

## Decision

Adopt Apache License 2.0 for the upstream work.

The license is appropriate for this slice because it:

- permits commercial and non-commercial use, modification, and redistribution;
- provides an explicit contributor patent grant and patent-litigation termination clause;
- preserves attribution and change notices through clear redistribution conditions;
- permits separate paid support, warranty, hosting, and enterprise agreements; and
- keeps trademark rights outside the copyright and patent license.

The repository uses an inbound-equals-outbound contribution model under Section 5. No additional contributor license agreement or certificate is required by this slice.

## Deliverables

- `LICENSE`: unmodified Apache License 2.0 text.
- `NOTICE`: upstream attribution, third-party notice boundary, and trademark reservation.
- `CONTRIBUTING.md`: contribution provenance, licensing, security, testing, and merge obligations.
- `SECURITY.md`: private-first vulnerability reporting and bounded safe-harbor scope.
- `docs/legal/privacy.md`: versioned upstream-project privacy notice with an explicit self-hosted-operator boundary.
- `docs/legal/terms.md`: versioned community and reference-project terms that defer source rights to Apache-2.0.
- `README.md`: entry-point links and removal of obsolete branch and no-license statements.
- `package.json`: SPDX license metadata and formatting coverage.
- `packages/commercial-readiness/src/legal-contract.test.mjs`: deterministic evidence that required notices remain consistent.

## Explicit non-goals

- selecting a governing law or forum;
- inventing a legal entity, postal address, privacy officer, or support email;
- defining terms for a hosted service that does not yet exist;
- promising fixed support, vulnerability-response, retention, availability, or remediation times;
- representing independent deployment infrastructure or providers as upstream subprocessors;
- granting trademark rights or weakening Apache-2.0 warranty and liability terms; or
- implementing runtime consent, data export, erasure, or policy-enforcement features.

## Risk controls

- Repository and community processing is separated from operator-controlled deployment data.
- Public contribution history is described as replicated and not fully erasable by maintainers.
- Security reporting forbids public disclosure of sensitive evidence and limits testing authority.
- AI-assisted output is described as requiring human review and not suitable as sole high-impact advice.
- Self-hosting responsibilities are stated without claiming that documentation constitutes compliance certification.
- Separate commercial agreements may add support or service commitments without modifying existing open-source rights.

## Verification

The legal contract test must prove that:

- root package metadata declares `Apache-2.0`;
- the license includes patent, redistribution, and warranty sections;
- the notice identifies the upstream project and preserves the trademark boundary;
- privacy and terms documents are versioned, dated, and distinguish independent deployments;
- contribution provenance and private security reporting are explicit;
- README links every required notice; and
- obsolete no-license and `develop`-branch statements do not return.

The exact pull-request head must also pass formatting, lint, type checking, tests, build, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and all actionable review feedback before merge.

## Rollback

Because a public license grant may be relied upon once distributed, rollback must not imply revocation of Apache-2.0 rights already granted for prior versions. A future licensing change would require an explicit version boundary, provenance review, and confirmation that the project has authority over the affected contributions.
