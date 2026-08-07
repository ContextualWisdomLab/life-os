# Purpose-bound personal-data access control mapping

**System component:** LifeOS `privacy-service`  
**Evidence status:** Design and implementation mapping; not a certification or auditor opinion  
**Last reviewed:** 2026-08-07

## Scope

The privacy service makes and records purpose-bound access decisions and consumes short-lived single-use grants. It never reads another bounded context's tables and never stores the personal-data values returned by a consuming service. Authorized payloads remain original; confidentiality is provided by identity, tenant isolation, policy, cryptography, restricted egress, and audit evidence rather than destructive masking.

## Control-evidence matrix

| Control family | LifeOS technical control | Primary evidence | Deployment responsibility |
| --- | --- | --- | --- |
| Identity and authentication | Signed workspace/actor/method/path context with active/previous key selection and 60-second validity | `privacy-service-context.ts`, context tests | Identity proofing, session assurance, workload identity, key custody |
| Authorization | Explicit purpose, action, resource category, mode, policy revision, and TTL matrix | `privacy-access-domain.ts`, policy tests | Legal-basis and purpose governance, role assignment, access review |
| Least privilege | Narrow category/action combinations; 15-minute ordinary and 5-minute read-only break-glass caps | Domain tests and design specification | Workforce approval and privileged-access process |
| Emergency access | Separate `break_glass` purpose and mode with mandatory reason digest | Domain, token, repository evidence | Dual control, alert delivery, post-event review, incident linkage |
| Cryptography | HMAC-SHA-256 context/grant signatures; independent keyed audit digests; active/previous overlap | Token/context tests, rotation runbook | KMS/HSM, generation entropy, rotation execution, revocation |
| Replay resistance | Single-use grant row transition and unique append-only access event | PostgreSQL repository and concurrency integration tests | Clock synchronization and database high availability |
| Tenant isolation | Workspace and actor included in signed context, token claims, SQL predicates, and row validation | HTTP, token, repository tests | Gateway membership authorization and service network policy |
| Audit generation | Every allow/deny decision and successful consumption has UUIDv4 evidence | Migration, repository, integration tests | Retention schedule, access to audit evidence, external export |
| Audit protection | Decision/event mutation rejection; grant transition restricted; token/reason/reference stored as keyed digests | Migration trigger tests and runbook | Immutable off-system retention, DBA separation, monitoring |
| Data minimization | No PII value, raw reason, token, or resource reference in privacy schema or telemetry | Migration tests, realistic Unicode PII test | Consumer logging/trace configuration and data classification |
| Processing integrity | Policy digest, revision, canonical claims, exact-key verification, transaction rollback | Domain/token/repository tests | Change approval and policy-owner review |
| Availability | Bounded PostgreSQL pool, explicit health route, fail-closed request behavior | Runtime/server tests and Compose health check | SLOs, alerting, capacity, database recovery |
| Change management | PR checks, 100% coverage, AppGuardrail, Semgrep, security scan, CodeRabbit, exact-head merge | GitHub workflow evidence | Reviewer independence, release approval, emergency change process |
| Data-subject rights | Purpose code supports separately governed read/export processing | Policy matrix and data-rights capability references | Identity verification, export orchestration, statutory response time |

## NIST SP 800-53 Rev. 5 alignment

| Control | Evidence contribution |
| --- | --- |
| AC-2, AC-3, AC-6 | Trusted actor context, explicit policy evaluation, least-privilege grant |
| AC-16 | Purpose, action, category, mode, policy revision, and validity attributes |
| AU-2, AU-3, AU-9, AU-12 | Selected decision/access events, bounded metadata, append-only protection, generation |
| IA-2, IA-5 | Authenticated actor/workspace context and managed signing keys |
| SC-8, SC-12, SC-13, SC-28 | Transport/key/data protection responsibilities and configuration |
| SI-4, SI-12 | Bounded monitoring classifications and metadata-only information handling |
| PT-2 through PT-7 | Authority/purpose/consent linkage, minimization, specific-use restriction, transparency evidence |

## NIST Privacy Framework alignment

- **Identify-P:** registered resource categories and processing purposes.
- **Govern-P:** versioned reviewed policy, standards mapping, ownership boundaries.
- **Control-P:** explicit allowed/denied decisions and single-use grants.
- **Communicate-P:** opaque receipts support protected explanations and data-subject workflows.
- **Protect-P:** cryptography, tenant isolation, restricted egress, and audit protection.

## SOC 2 Trust Services Criteria alignment

- **Security:** logical access, authentication context, least privilege, change and vulnerability evidence.
- **Confidentiality:** restricted use, encrypted secret handling, no copied payloads in audit/telemetry.
- **Processing integrity:** versioned policy/digest, exact claim validation, atomic grant consumption.
- **Privacy:** purpose limitation, data minimization, access evidence, data-subject-purpose support.

A SOC 2 examination requires management's system description and assertion, control owners, a defined period, and auditor testing. Repository evidence alone is insufficient.

## ISMS-P and Korean PIPA alignment

The component contributes evidence for access control, least privilege, access records, cryptography, personal-data minimization, purpose limitation, safe handling, incident investigation, and controlled destruction/retention integration. Production operators must determine legal basis, notices/consents, processing records, statutory retention, outsourcing, cross-border transfer, data-residency, and data-subject response procedures.

## CSAP alignment

The component supports technical evidence relevant to:

- identity and privileged-access control;
- data isolation and cryptographic protection;
- logging and audit protection;
- secure development and vulnerability scanning;
- change/release management;
- backup/recovery and incident evidence;
- cloud service boundary and least-privilege network exposure.

The applicable CSAP assurance level, cloud-service model, region, provider controls, and certification scope are deployment decisions. The independently deployable privacy-service and provider-neutral Compose/Kubernetes contracts do not themselves establish CSAP certification.

## Evidence retention and privacy

Evidence records contain sensitive metadata even though raw PII is absent. Restrict database and artifact access, encrypt backups, define retention, and record evidence exports. Keyed digests may reveal equality and can be susceptible to guessing for low-entropy domains; use independently protected keys and rotate them under an approved retention/migration plan.

## Residual gaps

- hardware-backed/asymmetric workload identity;
- dual-control and real-time break-glass alerts;
- external immutable evidence anchoring;
- field-level classification and per-field policy;
- automated access-review UI and anomaly detection;
- production KMS/HSM integration;
- formal legal-basis/consent registry;
- complete CSAP/SOC 2 operating-period evidence.

These are tracked as follow-up capabilities and must not be represented as implemented controls.
