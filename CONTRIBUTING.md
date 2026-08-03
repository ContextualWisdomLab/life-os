# Contributing to LifeOS

Thank you for improving LifeOS. Contributions should preserve the project's tenant-safety, explicit service boundaries, auditable behavior, and reviewable delivery model.

## License of contributions

LifeOS uses an inbound-equals-outbound model.

Unless you clearly state otherwise in writing before submission, any contribution intentionally submitted for inclusion in this repository is provided under the Apache License 2.0, including its copyright and patent terms, without additional conditions. This follows Section 5 of `LICENSE`.

By submitting a contribution, you represent that:

- you created the contribution or otherwise have the right to submit it;
- the contribution may be distributed under Apache-2.0;
- you have disclosed any third-party code, generated material, or license obligations it contains;
- you are not submitting confidential employer, customer, or third-party information; and
- the contribution contains no credentials, tokens, private keys, production exports, or unnecessary personal data.

A separate contributor agreement applies only when explicitly executed in writing.

## Before opening a pull request

1. Search existing issues and pull requests to avoid duplicate work.
2. For a material capability, create or reference an issue that defines the user outcome, bounded initial slice, deferred scope, and validation gate.
3. Keep changes inside the existing bounded context unless a versioned contract justifies a cross-service dependency.
4. Add or update tests for behavior changes, failure boundaries, tenant isolation, and security-sensitive paths.
5. Update documentation, migrations, operational guidance, and the changelog when the change affects users or operators.
6. Run the repository validation commands that apply to the changed packages.

## Development workflow

Create a descriptive branch from the current `main` branch and open a pull request back to `main`. Do not push feature work directly to protected branches.

Use descriptive commit and pull-request titles. A pull request should explain:

- the buyer-visible or operator-visible outcome;
- the exact capability boundary and deferred work;
- security and privacy implications;
- migrations, deployment, and rollback considerations when applicable; and
- the validation evidence for the exact head commit.

A pull request may merge only when required GitHub checks pass, no review requests changes, and no actionable human, automated, or security review thread remains unresolved. Administrative bypasses are not part of the normal contribution process.

## Engineering requirements

- Use opaque nonnumeric identifiers for domain entities.
- Prefer descriptive two-word-or-longer database object names.
- Derive tenant ownership from a trusted authenticated boundary; reject ownership injection through request bodies.
- Use parameterized persistence queries and bounded external calls.
- Keep secrets, credentials, tokens, and personal data out of source, logs, fixtures, errors, and telemetry.
- Avoid direct cross-service database access.
- Make retries and externally repeated commands idempotent where duplication can cause harm.
- Fail closed when authorization, tenant identity, concurrency, or data completeness cannot be established.
- Preserve deterministic tests and avoid dependence on public networks in the test suite.
- Document public APIs, security assumptions, environment variables, migrations, rollback, and deferred risks.

## Generated and AI-assisted contributions

AI-assisted work is welcome only when the contributor reviews and accepts responsibility for it. Do not submit generated code or text that you cannot explain, validate, license, and maintain. Disclose material generated content or third-party training/output restrictions when they may affect provenance or licensing.

## Security-sensitive findings

Do not open a public issue or pull request containing an unpatched vulnerability, exploit details, credentials, private data, or a reproduction that creates immediate user risk. Follow `SECURITY.md` first.

## Community conduct

Be specific, respectful, evidence-driven, and focused on improving the project. Harassment, threats, impersonation, deliberate deception, and disclosure of another person's private information are not acceptable. Maintainers may moderate participation to protect contributors, users, and the project.

## Legal and privacy references

- Source license: `LICENSE`
- Attribution and trademark notice: `NOTICE`
- Upstream privacy notice: `docs/legal/privacy.md`
- Upstream project terms: `docs/legal/terms.md`
- Vulnerability reporting: `SECURITY.md`
