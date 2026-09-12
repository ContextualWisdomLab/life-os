import assert from 'node:assert/strict';
import test from 'node:test';

const SARIF_SOURCE_REF =
  "ref: ${{ github.event_name == 'pull_request' && format('refs/pull/{0}/head', github.event.pull_request.number) || github.ref }}";
const SARIF_SOURCE_SHA =
  'sha: ${{ github.event.pull_request.head.sha || github.sha }}';

/** Mirrors the current source-binding assertions so hostile placement can be exercised directly. */
function assertSarifSourceBinding(uploadStep) {
  assert.ok(
    uploadStep.includes(SARIF_SOURCE_REF),
    'SARIF upload must bind ref to the analyzed contributor head',
  );
  assert.ok(
    uploadStep.includes(SARIF_SOURCE_SHA),
    'SARIF upload must bind sha to the analyzed contributor head',
  );
}

test('SARIF source binding accepts the reviewed direct with entries', () => {
  const uploadStep = [
    '      - name: Upload AppGuardrail SARIF to code scanning',
    '        uses: github/codeql-action/upload-sarif@reviewed-sha',
    '        with:',
    '          sarif_file: appguardrail.sarif',
    `          ${SARIF_SOURCE_REF}`,
    `          ${SARIF_SOURCE_SHA}`,
  ].join('\n');

  assert.doesNotThrow(() => assertSarifSourceBinding(uploadStep));
});

test('SARIF source binding rejects contributor markers moved outside direct with entries', () => {
  const hostileUploadStep = [
    '      - name: Upload AppGuardrail SARIF to code scanning',
    '        uses: github/codeql-action/upload-sarif@reviewed-sha',
    '        env:',
    `          SARIF_REF_MARKER: "${SARIF_SOURCE_REF}"`,
    `          SARIF_SHA_MARKER: "${SARIF_SOURCE_SHA}"`,
    '        with:',
    '          sarif_file: appguardrail.sarif',
  ].join('\n');

  assert.throws(
    () => assertSarifSourceBinding(hostileUploadStep),
    /must bind/u,
    'authority-looking ref/sha text outside with: must not satisfy upload input binding',
  );
});
