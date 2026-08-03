# Security policy

## Supported code

LifeOS is in active foundation development. Security fixes target the current `main` branch and the most recent release, when releases exist. Older commits, forks, modified deployments, and unsupported third-party integrations may require independent remediation by their operators.

## Report a vulnerability privately

Do **not** open a public issue, pull request, discussion, or commit containing an unpatched vulnerability, exploit details, credentials, private data, or a reproduction that could place users or deployments at immediate risk.

Use the repository's **Security** tab and select **Report a vulnerability** to submit a private report. Include only the information needed to reproduce and assess the issue:

- affected component, commit, version, or configuration;
- prerequisites and attack surface;
- minimal reproduction steps or a safe proof of concept;
- expected and observed behavior;
- plausible impact and tenant boundary implications;
- known workarounds or mitigation ideas; and
- whether the issue is already public or actively exploited.

If GitHub private vulnerability reporting is unavailable, open a public issue containing **no sensitive technical detail** and request a private reporting channel. Do not attach exploits, secrets, logs containing personal data, or screenshots that expose credentials.

## Safe-harbor scope

Good-faith research is welcome when it:

- targets only systems, accounts, deployments, and data you own or are explicitly authorized to test;
- avoids privacy violations, service disruption, destructive actions, persistence, social engineering, and unnecessary data access;
- uses the minimum access needed to demonstrate the issue;
- stops when sensitive data or another tenant's boundary is encountered;
- preserves evidence securely and shares it only through the private channel; and
- allows maintainers a reasonable opportunity to investigate and remediate before public disclosure.

This policy does not authorize testing against infrastructure operated by independent LifeOS deployers, GitHub, cloud providers, identity providers, model providers, calendar providers, or other third parties.

## Triage and coordination

Maintainers will assess reproducibility, affected versions, exploitability, tenant impact, confidentiality, integrity, availability, and remediation options. Response and remediation timing depend on severity, complexity, maintainer availability, and coordination with affected dependencies or operators; this public repository does not promise a fixed service-level agreement.

Please coordinate disclosure timing. Maintainers may request additional evidence, prepare a patch, add regression tests, issue an advisory, and credit the reporter unless anonymity is requested. Reports that are duplicates, non-reproducible, outside scope, or purely theoretical without a credible impact may be closed with an explanation.

## Secrets and personal data

Never submit live credentials, tokens, private keys, production database contents, personal goals, health information, relationship data, private prompts, customer exports, or another person's data. Redact logs and use synthetic identifiers and fixtures.

If a secret is exposed, revoke or rotate it immediately. Removing it from the latest commit is not sufficient because Git history, forks, caches, and logs may retain copies.

## Dependency and deployment responsibility

The upstream project monitors and fixes issues in its source and declared dependencies where practicable. Independent operators remain responsible for secure configuration, patch deployment, network controls, identity-provider settings, secrets management, backups, monitoring, incident response, and third-party services.
