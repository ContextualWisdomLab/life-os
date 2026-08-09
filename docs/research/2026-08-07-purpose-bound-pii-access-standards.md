# Purpose-bound PII access governance: standards and research basis

**Date:** 2026-08-07  
**Status:** Current design basis; standards and legislation must be revalidated before a production certification assessment.

## Research question

How can LifeOS keep original personal data usable for authorized business operations without relying on destructive masking, while still providing defensible privacy, security, SOC 2, CSAP, and Korean privacy-control evidence?

## Decision

Masking is not the primary access-control mechanism for LifeOS production reads. Authorized consumers receive the original value. Confidentiality and accountability are enforced through:

1. strict workspace and actor identity;
2. purpose- and action-bound authorization;
3. explicit resource categories and policy revisions;
4. least privilege and short validity windows;
5. single-use grants for sensitive reads;
6. separate, shorter break-glass access with a mandatory reason;
7. encryption in transit and at rest;
8. append-only decision and access evidence;
9. metadata- and digest-only operational telemetry;
10. egress controls that prevent authorized payloads from being copied into logs, traces, artifacts, analytics, or model training.

This is a controlled-access design, not a claim that masking is never useful. Masking, pseudonymization, or synthetic data remain appropriate for development, analytics, demonstrations, and workflows that do not require identity-bearing values.

## Standards mapping

### NIST Privacy Framework

The NIST Privacy Framework treats privacy risk as an enterprise risk-management concern rather than a single transformation applied to values. The LifeOS design maps primarily to Identify-P, Govern-P, Control-P, Communicate-P, and Protect-P. Purpose codes, policy revisions, consent or legal-basis metadata, access receipts, and deletion/export orchestration provide evidence that processing is known and governed. Short-lived grants and egress controls reduce the likelihood that personal data propagates beyond its approved use.

### NIST SP 800-53 Revision 5

The initial implementation supports evidence for:

- **AC-2, AC-3, AC-6:** account, enforcement, and least-privilege boundaries;
- **AC-16:** security and privacy attributes such as purpose, workspace, actor, and resource category;
- **AU-2, AU-3, AU-9, AU-12:** selected events, bounded event content, audit protection, and generation;
- **IA-2 and IA-5:** authenticated actor context and managed signing keys;
- **SC-8, SC-12, SC-13, SC-28:** protected transport, key management, cryptographic protection, and data at rest;
- **SI-4 and SI-12:** monitoring and information-handling controls;
- **PT-2, PT-3, PT-4, PT-5, PT-6, PT-7:** authority, purpose, consent where applicable, privacy notice, minimization, and specific-use limits.

The code and evidence do not themselves certify an organization. Deployment identity proofing, workforce governance, key custody, incident response, retention, legal basis, and control operation remain operator responsibilities.

### NIST Zero Trust and ABAC

NIST SP 800-207 requires access decisions based on multiple dynamic signals rather than implicit network trust. NIST SP 800-162 describes attribute-based access control in terms of subject, object, requested operation, and environment attributes. LifeOS therefore evaluates actor, workspace, resource category, action, purpose, policy revision, time, and access mode for every grant. An internal network location alone never authorizes PII access.

### ISO/IEC 27001 and ISO/IEC 27701

ISO/IEC 27001:2022 establishes information-security management requirements; ISO/IEC 27701:2025 extends management-system treatment to privacy information. The implementation contributes technical evidence for access control, cryptography, logging, monitoring, privacy-by-design, purpose limitation, and accountability. Organizational scope, risk treatment, statements of applicability, processor/controller roles, records of processing, supplier controls, and internal audit remain outside this code-only slice.

### SOC 2 Trust Services Criteria

Purpose-bound authorization and immutable receipts support the Security, Confidentiality, Processing Integrity, and Privacy criteria. The design creates evidence relevant to logical access, authorization changes, restricted data use, monitoring, anomaly investigation, and retention. A SOC 2 report still requires a defined system description, management assertion, control owners, operating periods, and auditor testing.

### Korean PIPA, ISMS-P, and CSAP

Korean privacy law emphasizes lawful and limited collection and use, safety measures, access records, data-subject rights, retention and destruction, and accountability. ISMS-P and CSAP add operational expectations for access control, cryptography, logging, cloud isolation, change management, vulnerability management, incident response, backup, and evidence retention. LifeOS therefore preserves the minimum metadata needed to demonstrate who accessed which resource category for which purpose, while deliberately excluding copied PII from audit records.

Production deployment must still determine controller/processor roles, Korean data-residency and outsourcing obligations, cross-border transfer requirements, notice and consent requirements, statutory retention, and the exact CSAP assurance level and cloud operating model.

## Research basis

Purpose-based access control was proposed specifically to enforce privacy policies at database access time rather than treating access as a role-only decision (Byun & Li, 2008). Privacy-aware RBAC research similarly shows that purposes, conditions, and obligations must augment traditional roles for privacy-sensitive systems (Ni et al., 2010). The Hippocratic database model introduced purpose specification, consent, limited collection, limited use, disclosure, retention, and auditing as database responsibilities (Agrawal et al., 2002).

LifeOS applies those ideas conservatively:

- policy is explicit and versioned;
- grants are bounded and single-use;
- decisions and accesses are separate append-only evidence;
- raw PII never becomes an audit attribute;
- break-glass is distinguishable from ordinary processing;
- consumers receive original data only after a successful grant consumption.

The implementation does not claim that a policy engine can determine legal basis automatically. Purpose codes are technical enforcement labels whose organizational and legal meaning must be configured and governed by the deployment owner.

## PII handling alternatives to masking

| Control                        | Production use                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| Tenant isolation               | Required on every decision, grant, query, and audit record                                |
| Purpose-based ABAC             | Required before issuing a grant                                                           |
| Single-use, short-lived grants | Required for sensitive reads                                                              |
| Encryption                     | Required in transit and at rest; application/key separation is deployment-owned           |
| Metadata-only audit            | Required; payload values are replaced by canonical digests in evidence                    |
| Egress control                 | Required for logs, traces, metrics, artifacts, analytics, support tooling, and LLM inputs |
| Just-in-time / break-glass     | Separate short policy with reason and post-access review evidence                         |
| Pseudonymization               | Optional for analytics where identity is not required                                     |
| Synthetic data                 | Required preference for tests, examples, screenshots, and demos                           |
| Masking                        | Optional presentation control, never a substitute for authorization                       |

## Residual risks

- An authorized endpoint can still exfiltrate data if its business logic or operator is compromised.
- Shared HMAC secrets do not provide hardware-backed workload identity or asymmetric non-repudiation.
- Digests can reveal equality and may be susceptible to guessing when input domains are small; keyed digests or random salts may be required per field.
- Break-glass access can be abused without independent review and alert delivery.
- Append-only database triggers do not replace immutable off-system retention.
- Policy correctness depends on accurate identity, resource classification, legal basis, and deployment configuration.

These risks are addressed in later slices through asymmetric workload identity, dual-control break-glass approval, external evidence anchoring, field-classification registries, anomaly detection, and formal retention policy.

## References

Agrawal, R., Kiernan, J., Srikant, R., & Xu, Y. (2002). Hippocratic databases. In _Proceedings of the 28th International Conference on Very Large Data Bases_ (pp. 143–154). VLDB Endowment.

American Institute of Certified Public Accountants. (2022). _2017 Trust services criteria for security, availability, processing integrity, confidentiality, and privacy (with revised points of focus—2022)_.

Byun, J.-W., & Li, N. (2008). Purpose based access control for privacy protection in relational database systems. _The VLDB Journal, 17_(4), 603–619. https://doi.org/10.1007/s00778-006-0023-0

Hu, V. C., Ferraiolo, D., Kuhn, D. R., Schnitzer, A., Sandlin, K., Miller, R., & Scarfone, K. (2014). _Guide to attribute based access control (ABAC) definition and considerations_ (NIST Special Publication 800-162). National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-162

International Organization for Standardization. (2022). _ISO/IEC 27001:2022 information security, cybersecurity and privacy protection—Information security management systems—Requirements_.

International Organization for Standardization. (2025). _ISO/IEC 27701:2025 information security, cybersecurity and privacy protection—Privacy information management systems—Requirements and guidance_.

Korea Internet & Security Agency. (2023). _Information security and personal information management system (ISMS-P) certification criteria_.

Korea Internet & Security Agency. (2025). _Cloud Security Assurance Program (CSAP) certification guidance_.

Ministry of Government Legislation. (2026). _Personal Information Protection Act_. Korean Law Information Center.

National Institute of Standards and Technology. (2020a). _NIST privacy framework: A tool for improving privacy through enterprise risk management, version 1.0_ (NIST Cybersecurity White Paper 10). https://doi.org/10.6028/NIST.CSWP.01162020

National Institute of Standards and Technology. (2020b). _Security and privacy controls for information systems and organizations_ (NIST Special Publication 800-53, Revision 5). https://doi.org/10.6028/NIST.SP.800-53r5

National Institute of Standards and Technology. (2020c). _Zero trust architecture_ (NIST Special Publication 800-207). https://doi.org/10.6028/NIST.SP.800-207

Ni, Q., Bertino, E., Lobo, J., Brodie, C., Karat, C.-M., Karat, J., & Trombeta, A. (2010). Privacy-aware role-based access control. _ACM Transactions on Information and System Security, 13_(3), Article 24. https://doi.org/10.1145/1805874.1805880
