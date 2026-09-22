import { createHmac, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { performance } from 'node:perf_hooks';
import pg from 'pg';

const { Pool } = pg;
const DEFAULT_ITERATIONS = 1000;
const DEFAULT_VUS = 10;
const MAX_ITERATIONS = 10000;
const MAX_VUS = 100;
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const DELIVERY_ID = '33333333-3333-4333-8333-333333333333';
const PATH = `/v1/plugins/delivery-attempts/${DELIVERY_ID}`;

function fail(message) {
  throw new Error(message);
}

function boundedInteger(value, fallback, maximum, name) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    return fail(`${name} is outside the profiling bound`);
  }
  return parsed;
}

function requireSecret(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 32) {
    return fail('Integration profiling context secret is unavailable');
  }
  return value;
}

function requireDatabaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return fail('Integration profiling database authority is unavailable');
  }
  return value;
}

function percentile(sorted, fraction) {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function report(profile, samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const average = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  process.stdout.write(
    `${JSON.stringify({
      profile,
      count: sorted.length,
      avgMs: Number(average.toFixed(2)),
      p50Ms: Number(percentile(sorted, 0.5).toFixed(2)),
      p90Ms: Number(percentile(sorted, 0.9).toFixed(2)),
      p95Ms: Number(percentile(sorted, 0.95).toFixed(2)),
      p99Ms: Number(percentile(sorted, 0.99).toFixed(2)),
      maxMs: Number(sorted.at(-1).toFixed(2)),
    })}\n`,
  );
}

async function runConcurrent(count, concurrency, operation) {
  const samples = new Array(count);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= count) {
        return;
      }
      const startedAt = performance.now();
      await operation(index);
      samples[index] = performance.now() - startedAt;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return samples;
}

async function runConcurrentDurations(count, concurrency, operation) {
  const samples = new Array(count);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= count) {
        return;
      }
      const durationMs = await operation(index);
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        return fail(
          'Direct Integration status profile returned invalid timing',
        );
      }
      samples[index] = durationMs;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return samples;
}

function signedHeaders(secret) {
  const evidenceId = randomUUID();
  const issuedAt = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret)
    .update(
      `life-os.integration-operator-context.v1\n${WORKSPACE_ID}\n${USER_ID}\n${evidenceId}\n${issuedAt}\nGET\n${PATH}`,
      'utf8',
    )
    .digest('base64url');
  return {
    'x-life-os-workspace-id': WORKSPACE_ID,
    'x-life-os-user-id': USER_ID,
    'x-life-os-context-evidence-id': evidenceId,
    'x-life-os-context-issued-at': issuedAt,
    'x-life-os-context-signature': signature,
  };
}

async function requestDirectStatus(port, headers, agent) {
  return await new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const outbound = request(
      {
        hostname: '127.0.0.1',
        port,
        method: 'GET',
        path: PATH,
        headers,
        agent,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.once('error', reject);
        response.on('end', () => {
          const durationMs = performance.now() - startedAt;
          if (response.statusCode !== 200) {
            reject(
              new Error('Direct Integration status profile received non-200'),
            );
            return;
          }
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (body.deliveryId !== DELIVERY_ID) {
              reject(
                new Error(
                  'Direct Integration status profile received wrong delivery',
                ),
              );
              return;
            }
          } catch {
            reject(
              new Error(
                'Direct Integration status profile received invalid JSON',
              ),
            );
            return;
          }
          resolve(durationMs);
        });
      },
    );
    outbound.once('error', reject);
    outbound.end();
  });
}

const iterations = boundedInteger(
  process.env.LIFEOS_PERF_ITERATIONS,
  DEFAULT_ITERATIONS,
  MAX_ITERATIONS,
  'LIFEOS_PERF_ITERATIONS',
);
const vus = boundedInteger(
  process.env.LIFEOS_PERF_VUS,
  DEFAULT_VUS,
  MAX_VUS,
  'LIFEOS_PERF_VUS',
);
const contextSecret = requireSecret(
  process.env.INTEGRATION_OPERATOR_CONTEXT_SECRET,
);
const databaseUrl = requireDatabaseUrl(process.env.INTEGRATION_DATABASE_URL);
const servicePort = boundedInteger(
  process.env.INTEGRATION_SERVICE_PORT,
  4107,
  65535,
  'INTEGRATION_SERVICE_PORT',
);

const directHeaders = Array.from({ length: iterations }, () =>
  signedHeaders(contextSecret),
);
const { Agent } = await import('node:http');
const agent = new Agent({ keepAlive: true, maxSockets: vus });
try {
  const directHttpSamples = await runConcurrentDurations(
    iterations,
    vus,
    (index) => requestDirectStatus(servicePort, directHeaders[index], agent),
  );
  report('direct_http_application', directHttpSamples);
} finally {
  agent.destroy();
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: true },
  max: vus,
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
  query_timeout: 6000,
  idleTimeoutMillis: 30000,
});

try {
  await pool.query('SELECT 1');

  const replayConsumedAt = new Date();
  const replayExpiresAt = new Date(replayConsumedAt.getTime() + 60_000);
  const replayEvidence = Array.from({ length: iterations }, () => ({
    evidenceId: randomUUID(),
    consumedAt: replayConsumedAt.toISOString(),
    expiresAt: replayExpiresAt.toISOString(),
  }));
  const replaySamples = await runConcurrent(iterations, vus, async (index) => {
    const evidence = replayEvidence[index];
    const result = await pool.query(
      `SELECT plugin_integration.consume_plugin_operator_context_replay(
         $1::uuid, $2::timestamptz, $3::timestamptz
       ) AS consumed`,
      [evidence.evidenceId, evidence.consumedAt, evidence.expiresAt],
    );
    if (result.rowCount !== 1 || result.rows[0]?.consumed !== true) {
      return fail('Replay persistence profile did not consume evidence');
    }
  });
  report('postgres_replay_consume', replaySamples);

  const statusSamples = await runConcurrent(iterations, vus, async () => {
    const result = await pool.query(
      `SELECT authority_version, delivery_id, grant_id, installation_id,
              workspace_id, requested_by_user_id, delivery_status, attempt_count,
              max_attempts, requested_at, updated_at, next_attempt_at, terminal_at,
              last_outcome_code, control_sequence,
              (claim_token_digest IS NOT NULL) AS has_claim_token_digest,
              claim_started_at, claim_expires_at
       FROM plugin_integration.plugin_delivery_attempt_record
       WHERE delivery_id = $1::uuid
         AND workspace_id = $2::uuid
         AND requested_by_user_id = $3::uuid
       LIMIT 2`,
      [DELIVERY_ID, WORKSPACE_ID, USER_ID],
    );
    if (result.rowCount !== 1) {
      return fail(
        'Delivery status persistence profile did not find exact evidence',
      );
    }
  });
  report('postgres_status_read', statusSamples);

  const durability = await pool.query(
    'SELECT current_setting($1) AS synchronous_commit, current_setting($2) AS fsync',
    ['synchronous_commit', 'fsync'],
  );
  const row = durability.rows[0];
  process.stdout.write(
    `${JSON.stringify({
      profile: 'postgres_durability',
      synchronousCommit: row?.synchronous_commit,
      fsync: row?.fsync,
    })}\n`,
  );
} finally {
  await pool.end();
}
