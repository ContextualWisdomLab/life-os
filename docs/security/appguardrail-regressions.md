# AppGuardrail Security Regression Contract

LifeOS keeps security requirements executable. A security issue that AppGuardrail can detect should include a non-production regression fixture and an entry in `security/appguardrail-contract.json`.

## Required issue fields

Record all of the following in the LifeOS issue:

- the exact AppGuardrail `rule_id`;
- the expected severity;
- the expected finding context;
- the repository-relative fixture path;
- the production remediation requirement;
- the command or test that verifies the remediation and detector behavior.

Internal LifeOS identifiers used by fixtures or test data must remain opaque UUIDv4 strings. Never place personal data, production credentials, OAuth codes, provider tokens, PKCE verifiers, raw session tokens, or real secret material in a fixture.

## Fixture placement

Place intentional vulnerabilities under `tests/appguardrail-fixtures/`. AppGuardrail classifies this location as test context, which keeps the finding visible without making the fixture itself a deploy blocker. A fixture must not be imported by an application package or included in a production bundle.

Each contract entry uses this shape:

```json
{
  "issue": 16,
  "rule_id": "dangerous-cors",
  "severity": "HIGH",
  "context": "test",
  "file": "tests/appguardrail-fixtures/dangerous-cors.ts"
}
```

`packages/appguardrail-contract/src/verify-contract.mjs` requires an exact match in the normalized `appguardrail.findings.v1` output. Missing, renamed, downgraded, reclassified, or moved findings fail the AppGuardrail workflow.

## Adding a missing detector

When AppGuardrail does not yet detect the issue:

1. implement the detector and its tests in `ContextualWisdomLab/appguardrail`;
2. complete AppGuardrail review and required checks;
3. merge the detector in AppGuardrail;
4. update the immutable AppGuardrail commit in `.github/workflows/appguardrail.yml`;
5. add the LifeOS fixture and detector-contract entry;
6. verify that the normal LifeOS scan remains clean while the fixture is reported in a non-blocking context.

Do not add a LifeOS exclusion merely to silence a new finding. Changes to `.appguardrail.json` require normal review and a documented false-positive or risk-acceptance rationale.

## Verification

Run the same pinned scanner revision used by GitHub Actions:

```bash
python3 /path/to/pinned/appguardrail/scanner/cli/appguardrail.py \
  scan --external off \
  --findings-json appguardrail-findings.json \
  --sarif appguardrail.sarif \
  .

node packages/appguardrail-contract/src/verify-contract.mjs \
  appguardrail-findings.json \
  security/appguardrail-contract.json
```

Delete local evidence files after verification. GitHub Actions retains its uploaded evidence for seven days.
