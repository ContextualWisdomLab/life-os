# Data-rights export integrity standards note

Status: Implemented on active PR

## Scope

This note records the standards basis for the tenant-export integrity evidence introduced by the active data-rights export-manifest change. It is implementation evidence, not a claim that the LifeOS serializer fully conforms to JSON Canonicalization Scheme (JCS).

## Decisions

1. Each contributor reports a schema-defined business `recordCount`; the LifeOS boundary accepts only safe non-negative integers. LifeOS does not infer business-record cardinality from arbitrary JSON shape.
2. Each normalized section receives a SHA-256 digest that binds contributor identity, schema version, record count, and bounded JSON data. The workspace-level digest continues to bind the ordered complete export manifest.
3. Object-property ordering used for integrity hashing is locale-independent and compares JavaScript strings by UTF-16 code-unit order. This follows the ordering requirement described by RFC 8785 while deliberately avoiding a broader JCS-conformance claim because the current serializer has not been independently proven against every JCS/I-JSON primitive-serialization requirement.
4. SHA-256 is used as the collision-resistant digest primitive. The current published Secure Hash Standard remains FIPS PUB 180-4; NIST has announced future revision work, so the published version remains the normative reference until a superseding final publication is available.
5. A digest is integrity evidence, not authorization, confidentiality, provenance, or a digital signature. Tenant authorization, export access control, encryption, retention, and delivery-channel protections remain separate controls.

## Acceptance evidence

The active PR must retain a real RED-to-GREEN regression proving that per-section count and digest evidence was absent before implementation and that malformed record-count evidence fails closed afterward. Exact-head CI/security/review evidence is required before merge. Protected main remains the shipped source of truth.

## APA 7 references

National Institute of Standards and Technology. (2015). *Secure Hash Standard (SHS) (FIPS PUB 180-4).* https://doi.org/10.6028/NIST.FIPS.180-4

Rundgren, A., Jordan, B., & Erdtman, S. (2020). *JSON Canonicalization Scheme (JCS) (RFC 8785).* RFC Editor. https://doi.org/10.17487/RFC8785
