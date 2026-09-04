# LifeOS doctoring references

**Scope:** Sources used by `docs/product-technical-gap-baseline.md` and the product/release gaps opened on 2026-08-20.  
**Status:** Reference inventory. External standards remain authoritative; this file does not reproduce restricted standard text or claim certification.

## Standards and security guidance

International Organization for Standardization, & International Electrotechnical Commission. (2023). *Systems and software engineering—Systems and software Quality Requirements and Evaluation (SQuaRE)—Product quality model (ISO/IEC 25010:2023).* https://www.iso.org/standard/78176.html

International Organization for Standardization, & International Electrotechnical Commission. (2025). *Information technology—Web Content Accessibility Guidelines (WCAG) 2.2 (ISO/IEC 40500:2025).* https://www.iso.org/standard/91029.html

National Institute of Standards and Technology. (2025). *Digital identity guidelines (NIST Special Publication 800-63-4).* U.S. Department of Commerce. https://doi.org/10.6028/NIST.SP.800-63-4

National Institute of Standards and Technology. (2025). *Digital identity guidelines: Authentication and authenticator management (NIST Special Publication 800-63B-4).* U.S. Department of Commerce. https://doi.org/10.6028/NIST.SP.800-63B-4

National Institute of Standards and Technology. (2025). *Digital identity guidelines: Federation and assertions (NIST Special Publication 800-63C-4).* U.S. Department of Commerce. https://doi.org/10.6028/NIST.SP.800-63C-4

NestJS. (n.d.). *Lifecycle events.* Retrieved September 4, 2026, from https://docs.nestjs.com/fundamentals/lifecycle-events

Node.js. (n.d.). *Undici: Specification compliance—Garbage collection.* Retrieved September 4, 2026, from https://undici.nodejs.org/#/?id=garbage-collection

node-postgres. (n.d.). *Connecting.* Retrieved September 4, 2026, from https://node-postgres.com/features/connecting

node-postgres. (n.d.). *pg.Client API.* Retrieved September 4, 2026, from https://node-postgres.com/apis/client

node-postgres. (n.d.). *pg.Pool API.* Retrieved September 4, 2026, from https://node-postgres.com/apis/pool

node-postgres. (n.d.). *Pooling.* Retrieved September 4, 2026, from https://node-postgres.com/features/pooling

node-postgres. (n.d.). *SSL.* Retrieved September 4, 2026, from https://node-postgres.com/features/ssl

OWASP Foundation. (2025). *OWASP Application Security Verification Standard 5.0.0.* https://owasp.org/www-project-application-security-verification-standard/

PostgreSQL Global Development Group. (n.d.). *13.3. Explicit locking (PostgreSQL 18 documentation).* Retrieved September 4, 2026, from https://www.postgresql.org/docs/18/explicit-locking.html

PostgreSQL Global Development Group. (n.d.). *41.9. Errors and messages (PostgreSQL 18 documentation).* Retrieved September 4, 2026, from https://www.postgresql.org/docs/18/plpgsql-errors-and-messages.html

SLSA Community. (2025). *Supply-chain Levels for Software Artifacts specification (Version 1.2).* https://slsa.dev/spec/v1.2/

SPDX Workgroup. (2024). *System Package Data Exchange specification (Version 3.0.1).* Linux Foundation. https://spdx.github.io/spdx-spec/

WHATWG. (n.d.). *Streams standard.* Retrieved September 4, 2026, from https://streams.spec.whatwg.org/

World Wide Web Consortium. (2024). *Web Content Accessibility Guidelines (WCAG) 2.2.* https://www.w3.org/TR/WCAG22/

## Behavioral-science basis

Gollwitzer, P. M. (1999). Implementation intentions: Strong effects of simple plans. *American Psychologist, 54*(7), 493–503. https://doi.org/10.1037/0003-066X.54.7.493

Gollwitzer, P. M., & Sheeran, P. (2006). Implementation intentions and goal achievement: A meta-analysis of effects and processes. *Advances in Experimental Social Psychology, 38*, 69–119. https://doi.org/10.1016/S0065-2601(06)38002-1

Lally, P., van Jaarsveld, C. H. M., Potts, H. W. W., & Wardle, J. (2010). How are habits formed: Modelling habit formation in the real world. *European Journal of Social Psychology, 40*(6), 998–1009. https://doi.org/10.1002/ejsp.674

Locke, E. A., & Latham, G. P. (2002). Building a practically useful theory of goal setting and task motivation: A 35-year odyssey. *American Psychologist, 57*(9), 705–717. https://doi.org/10.1037/0003-066X.57.9.705

## Traceability notes

- ISO/IEC 25010:2023 is used as the product-quality vocabulary for completion and acquisition evidence, not as a claim that every characteristic is already satisfied.
- WCAG 2.2 AA is the intended first-party web/PWA conformance target. Automated checks are necessary but not sufficient; manual keyboard and assistive-technology journeys remain required.
- NIST SP 800-63-4 is guidance for risk-based identity, authenticator, session, and federation decisions. LifeOS does not claim a government identity assurance level solely by citing the publication.
- OWASP ASVS identifiers must include the exact version when entered into traceability records.
- PostgreSQL 18 Section 13.3 is the authority for #235's row-lock serialization: `FOR SHARE` conflicts with concurrent `UPDATE`, `DELETE`, `SELECT FOR UPDATE`, and `SELECT FOR NO KEY UPDATE` on the selected installation row. Section 41.9 is the authority for bounded PL/pgSQL `RAISE` metadata. These citations support the mechanism; they are not execution evidence that the migration passed on a database.
- WHATWG Streams defines readable-stream cancellation as consumer loss of interest that closes the stream, discards queued chunks, and invokes the underlying source cancellation mechanism. Node.js Undici additionally warns that leaving response-body resource release to garbage collection can reduce connection reuse and cause stalls or deadlocks; #242 therefore requires every acquired Vault replay body to be consumed or cancelled on abnormal exit. These references justify the transport-cleanup contract but are not package or integration execution evidence.
- NestJS lifecycle documentation states that registered `onApplicationShutdown` hooks run during explicit application close and, after `enableShutdownHooks`, signal-driven termination. node-postgres documents `pool.end()` as draining active clients, disconnecting clients, and stopping pool timers. #244 uses those primary contracts to bind the Integration-owned Plugin pool to the Nest application lifecycle. They support the ownership mechanism but do not prove real PostgreSQL/Vault acceptance.
- node-postgres documents that missing client connection fields are supplied from libpq-style process environment variables such as `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGPORT`, and `PGDATABASE`. It also documents that SSL-related connection-string parameters such as `sslmode`, `sslcert`, `sslkey`, and `sslrootcert` replace an explicitly supplied `ssl` object. The concrete Plugin PostgreSQL successor therefore requires a complete URI for core target/credential authority and rejects every URI query parameter before constructing `pg.Pool`, so query parsing cannot silently become a second transport-policy surface. This supports the driver-boundary rationale; it is not frozen-lock, package, TLS-policy, or real-database execution evidence.
- node-postgres Pool documentation exposes finite pool-size, idle-timeout, connection-acquisition-timeout, and maximum-lifetime controls; the documented default `connectionTimeoutMillis` is `0`, meaning no acquisition timeout. Its pooling guidance also requires an `error` listener for errors emitted by idle clients and warns that an unhandled pool `error` event can terminate the Node process. Draft #245 therefore makes these lifecycle values explicit and registers a credential-free listener before returning the Pool. The selected numeric bounds are a LifeOS operational policy subject to real PostgreSQL load/acceptance evidence; the primary documentation establishes the mechanism and failure mode, not that the selected values meet production capacity or p95 targets.
- SLSA claims must state the exact track and attained level with verifiable provenance; “SLSA compliant” is not an acceptable unqualified product claim.
- SPDX is used for SBOM exchange. An SBOM does not replace vulnerability assessment or license review.
- Goal-setting, implementation-intention, and habit research informs interaction design guardrails; LifeOS is not a medical or psychological treatment and does not diagnose users.

## Maintenance

Update this file when a referenced standard is superseded, a product acceptance criterion changes, or new research materially changes a behavior-design claim. Preserve historical references when they remain necessary to reconstruct earlier release decisions.
