import { createHmac, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const DEFAULT_ITERATIONS = 1000;
const MAX_ITERATIONS = 10000;
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const DELIVERY_ID = '33333333-3333-4333-8333-333333333333';
const PATH = `/v1/plugins/delivery-attempts/${DELIVERY_ID}`;

function fail(message) {
  throw new Error(message);
}

function iterations(value) {
  const parsed = value === undefined ? DEFAULT_ITERATIONS : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_ITERATIONS) {
    return fail('K6_ITERATIONS must be an integer between 1 and 10000');
  }
  return parsed;
}

function secret(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 32) {
    return fail('INTEGRATION_OPERATOR_CONTEXT_SECRET must contain at least 32 UTF-8 bytes');
  }
  return value;
}

const outputPath = process.argv[2];
if (!outputPath) {
  fail('authority output path is required');
}

const count = iterations(process.env.K6_ITERATIONS);
const contextSecret = secret(process.env.INTEGRATION_OPERATOR_CONTEXT_SECRET);
const issuedAt = String(Math.floor(Date.now() / 1000));
const authorities = Array.from({ length: count }, () => {
  const evidenceId = randomUUID();
  const signature = createHmac('sha256', contextSecret)
    .update(
      `life-os.integration-operator-context.v1\n${WORKSPACE_ID}\n${USER_ID}\n${evidenceId}\n${issuedAt}\nGET\n${PATH}`,
      'utf8',
    )
    .digest('base64url');

  return Object.freeze({
    path: PATH,
    deliveryId: DELIVERY_ID,
    headers: Object.freeze({
      'x-life-os-workspace-id': WORKSPACE_ID,
      'x-life-os-user-id': USER_ID,
      'x-life-os-context-evidence-id': evidenceId,
      'x-life-os-context-issued-at': issuedAt,
      'x-life-os-context-signature': signature,
    }),
  });
});

await writeFile(outputPath, `${JSON.stringify(authorities)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
