import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

const STATUS_EVIDENCE_KEYS = Object.freeze(
  [
    'attemptCount',
    'authorityVersion',
    'checkedAt',
    'claimState',
    'controlSequence',
    'deliveryId',
    'deliveryStatus',
    'grantId',
    'installationId',
    'lastOutcomeCode',
    'maxAttempts',
    'nextAttemptAt',
    'requestedAt',
    'requestedByUserId',
    'terminalAt',
    'updatedAt',
    'workspaceId',
  ].sort(),
);

function boundedInteger(name, fallback, minimum, maximum) {
  const raw = __ENV[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function hasExactStatusEvidenceKeys(result) {
  try {
    const body = result.json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return false;
    }
    const keys = Object.keys(body).sort();
    return (
      keys.length === STATUS_EVIDENCE_KEYS.length &&
      keys.every((key, index) => key === STATUS_EVIDENCE_KEYS[index])
    );
  } catch {
    return false;
  }
}

const iterations = boundedInteger('LIFEOS_PERF_ITERATIONS', 1000, 1, 10000);
const vus = boundedInteger('LIFEOS_PERF_VUS', 10, 1, 100);
const authorityFile = __ENV.LIFEOS_PERF_AUTHORITY_FILE;
const baseUrl = __ENV.LIFEOS_PERF_BASE_URL;

if (!authorityFile) {
  throw new Error('LIFEOS_PERF_AUTHORITY_FILE is required');
}
if (!baseUrl || !/^https:\/\/127\.0\.0\.1:\d+$/u.test(baseUrl)) {
  throw new Error(
    'LIFEOS_PERF_BASE_URL must be an explicit loopback HTTPS endpoint',
  );
}

const authorities = new SharedArray('plugin-delivery-status-authority', () => {
  const parsed = JSON.parse(open(authorityFile));
  if (!Array.isArray(parsed) || parsed.length !== iterations) {
    throw new Error(
      'authority bundle must contain exactly LIFEOS_PERF_ITERATIONS entries',
    );
  }
  return parsed;
});

export const options = {
  scenarios: {
    plugin_delivery_status: {
      executor: 'shared-iterations',
      vus,
      iterations,
      maxDuration: '45s',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:plugin_delivery_status}': ['p(95)<20'],
    'http_req_failed{endpoint:plugin_delivery_status}': ['rate==0'],
    checks: ['rate==1'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const authority = authorities[exec.scenario.iterationInTest];
  if (!authority) {
    throw new Error('missing unique authority for iteration');
  }

  const response = http.get(`${baseUrl}${authority.path}`, {
    headers: authority.headers,
    redirects: 0,
    timeout: '2s',
    tags: { endpoint: 'plugin_delivery_status' },
  });

  check(response, {
    'status is 200': (result) => result.status === 200,
    'status evidence matches delivery': (result) =>
      result.status === 200 &&
      result.json('deliveryId') === authority.deliveryId,
    'status evidence uses the exact credential-free contract': (result) =>
      result.status === 200 && hasExactStatusEvidenceKeys(result),
  });
}
