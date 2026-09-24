from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one replacement, found {count}')
    write(path, text.replace(old, new, 1))


service_origin = """const MAXIMUM_SERVICE_ORIGIN_LENGTH = 2048;

/** Explicit server-side authority for the only supported cleartext exception. */
export type ServiceOriginHttpMode = 'loopback' | undefined;

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  );
}

/**
 * Requires an origin-only upstream service URL. HTTPS is the default; cleartext
 * HTTP is accepted only when the caller explicitly selects `loopback` and the
 * parsed host is an exact local loopback name/address. Browser input cannot
 * widen this server-owned transport exception.
 */
export function requireSecureServiceOrigin(
  value: string | undefined,
  httpMode?: string,
): string {
  if (
    !value ||
    value.length > MAXIMUM_SERVICE_ORIGIN_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error('Service origin is invalid');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Service origin is invalid');
  }

  const transportAllowed =
    parsed.protocol === 'https:' ||
    (parsed.protocol === 'http:' &&
      httpMode === 'loopback' &&
      isLoopbackHostname(parsed.hostname));

  if (
    !transportAllowed ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Service origin is invalid');
  }

  return parsed.origin;
}
"""
Path('packages/contracts/src/service-origin.ts').write_text(
    service_origin, encoding='utf-8'
)

service_origin_test = """import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireSecureServiceOrigin } from './dist/service-origin.js';

test('service origin transport is HTTPS by default with explicit loopback-only HTTP', () => {
  assert.equal(
    requireSecureServiceOrigin('https://identity.example.test'),
    'https://identity.example.test',
  );

  for (const origin of [
    'http://identity.example.test',
    'http://127.0.0.1:4101',
    'ftp://127.0.0.1:4101',
    'https://user:secret@identity.example.test',
    'https://identity.example.test/path',
    'https://identity.example.test/?query=1',
    'https://identity.example.test/#fragment',
  ]) {
    assert.throws(() => requireSecureServiceOrigin(origin));
  }

  for (const origin of [
    'http://identity.example.test',
    'http://10.0.0.2:4101',
  ]) {
    assert.throws(() => requireSecureServiceOrigin(origin, 'loopback'));
  }

  assert.equal(
    requireSecureServiceOrigin('http://127.0.0.1:4101', 'loopback'),
    'http://127.0.0.1:4101',
  );
  assert.equal(
    requireSecureServiceOrigin('http://localhost:4101', 'loopback'),
    'http://localhost:4101',
  );
  assert.equal(
    requireSecureServiceOrigin('http://[::1]:4101', 'loopback'),
    'http://[::1]:4101',
  );
});
"""
Path('packages/contracts/service-origin.test.mjs').write_text(
    service_origin_test, encoding='utf-8'
)

replace_once(
    'packages/contracts/src/index.ts',
    "export * from './data-rights.js';\n",
    "export * from './data-rights.js';\nexport * from './service-origin.js';\n",
)
replace_once(
    'packages/contracts/package.json',
    '  "types": "dist/index.d.ts",',
    '  "types": "src/index.ts",',
)

web_package = read('apps/web/package.json')
if '"@life-os/contracts"' in web_package:
    raise SystemExit('apps/web already declares @life-os/contracts')
web_package = web_package.replace(
    '  "dependencies": {\n    "next":',
    '  "dependencies": {\n    "@life-os/contracts": "workspace:*",\n    "next":',
    1,
)
web_package = web_package.replace(
    '"test": "tsx --test app/localization.test.ts',
    '"test": "tsx --test app/service-origin-transport.test.ts app/ai-service-origin-transport.test.ts app/localization.test.ts',
    1,
)
write('apps/web/package.json', web_package)

env = read('.env.example')
if 'SERVICE_ORIGIN_HTTP_MODE=' in env:
    raise SystemExit('.env.example already declares SERVICE_ORIGIN_HTTP_MODE')
env = env.replace(
    'CORS_ALLOWED_ORIGINS=http://localhost:3000\n',
    'CORS_ALLOWED_ORIGINS=http://localhost:3000\nSERVICE_ORIGIN_HTTP_MODE=loopback\n',
    1,
)
write('.env.example', env)

planning = 'apps/web/app/planning-search-client.ts'
replace_once(
    planning,
    "import { createHmac, randomUUID } from 'node:crypto';\n",
    "import { requireSecureServiceOrigin } from '@life-os/contracts';\nimport { createHmac, randomUUID } from 'node:crypto';\n",
)
replace_once(
    planning,
    """/** Requires a fixed service origin with no credentials, path, query, or fragment. */
export function requireServiceOrigin(value: string | undefined): string {
  if (!value || value.length > 2048 || /[\\u0000-\\u001f\\u007f]/.test(value)) {
    throw new Error('Service origin is invalid');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Service origin is invalid');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Service origin is invalid');
  }
  return parsed.origin;
}
""",
    """/** Applies the shared upstream transport policy with the Web-facing stable error. */
export function requireServiceOrigin(
  value: string | undefined,
  httpMode?: string,
): string {
  try {
    return requireSecureServiceOrigin(value, httpMode);
  } catch {
    throw new Error('Service origin is invalid');
  }
}
""",
)
replace_once(
    planning,
    """  try {
    const identityOrigin = requireServiceOrigin(
      environment.IDENTITY_SERVICE_ORIGIN,
    );
    const planningOrigin = requireServiceOrigin(
      environment.PLANNING_SERVICE_ORIGIN,
    );
""",
    """  try {
    const transportMode = environment.SERVICE_ORIGIN_HTTP_MODE;
    const identityOrigin = requireServiceOrigin(
      environment.IDENTITY_SERVICE_ORIGIN,
      transportMode,
    );
    const planningOrigin = requireServiceOrigin(
      environment.PLANNING_SERVICE_ORIGIN,
      transportMode,
    );
""",
)

today = 'apps/web/app/today-sync-client.ts'
replace_once(
    today,
    """  try {
    const identityOrigin = requireServiceOrigin(
      environment.IDENTITY_SERVICE_ORIGIN,
    );
    const planningOrigin = requireServiceOrigin(
      environment.PLANNING_SERVICE_ORIGIN,
    );
""",
    """  try {
    const transportMode = environment.SERVICE_ORIGIN_HTTP_MODE;
    const identityOrigin = requireServiceOrigin(
      environment.IDENTITY_SERVICE_ORIGIN,
      transportMode,
    );
    const planningOrigin = requireServiceOrigin(
      environment.PLANNING_SERVICE_ORIGIN,
      transportMode,
    );
""",
)

ai = 'apps/web/app/ai-proposal-client-core.ts'
replace_once(
    ai,
    "import { createHmac, randomUUID } from 'node:crypto';\n",
    "import { requireSecureServiceOrigin } from '@life-os/contracts';\nimport { createHmac, randomUUID } from 'node:crypto';\n",
)
replace_once(
    ai,
    """/** Requires a fixed HTTP(S) service origin without credentials or path data. */
export function requireAiServiceOrigin(value: string | undefined): string {
  if (!value || value.length > 2048 || /[\\u0000-\\u001f\\u007f]/u.test(value)) {
    throw new Error('AI service origin is invalid');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('AI service origin is invalid');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('AI service origin is invalid');
  }
  return parsed.origin;
}
""",
    """/** Applies the shared upstream transport policy with the AI-facing stable error. */
export function requireAiServiceOrigin(
  value: string | undefined,
  httpMode?: string,
): string {
  try {
    return requireSecureServiceOrigin(value, httpMode);
  } catch {
    throw new Error('AI service origin is invalid');
  }
}
""",
)
replace_once(
    ai,
    """    const identityOrigin = requireAiServiceOrigin(
      environment.IDENTITY_SERVICE_ORIGIN,
    );
    const aiOrigin = requireAiServiceOrigin(environment.AI_SERVICE_ORIGIN);
""",
    """    const transportMode = environment.SERVICE_ORIGIN_HTTP_MODE;
    const identityOrigin = requireAiServiceOrigin(
      environment.IDENTITY_SERVICE_ORIGIN,
      transportMode,
    );
    const aiOrigin = requireAiServiceOrigin(
      environment.AI_SERVICE_ORIGIN,
      transportMode,
    );
""",
)

gateway = 'apps/gateway/src/today-composition.ts'
replace_once(
    gateway,
    "import { createHmac, randomUUID } from 'node:crypto';\n",
    "import { requireSecureServiceOrigin } from '@life-os/contracts';\nimport { createHmac, randomUUID } from 'node:crypto';\n",
)
replace_once(
    gateway,
    """  readonly IDENTITY_SERVICE_ORIGIN?: string;
  readonly PLANNING_SERVICE_ORIGIN?: string;
""",
    """  readonly IDENTITY_SERVICE_ORIGIN?: string;
  readonly PLANNING_SERVICE_ORIGIN?: string;
  readonly SERVICE_ORIGIN_HTTP_MODE?: string;
""",
)
replace_once(
    gateway,
    """function requireServiceOrigin(value: string | undefined): string {
  if (!value || value.length > 2048 || /[\\u0000-\\u001f\\u007f]/u.test(value)) {
    throw unavailable();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw unavailable();
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw unavailable();
  }
  return parsed.origin;
}
""",
    """function requireServiceOrigin(
  value: string | undefined,
  httpMode?: string,
): string {
  try {
    return requireSecureServiceOrigin(value, httpMode);
  } catch {
    throw unavailable();
  }
}
""",
)
replace_once(
    gateway,
    """  const safeDate = requireDate(date);
  const safeCookie = requireCookie(cookie);
  const identityOrigin = requireServiceOrigin(
    environment.IDENTITY_SERVICE_ORIGIN,
  );
  const planningOrigin = requireServiceOrigin(
    environment.PLANNING_SERVICE_ORIGIN,
  );
""",
    """  const safeDate = requireDate(date);
  const safeCookie = requireCookie(cookie);
  const transportMode = environment.SERVICE_ORIGIN_HTTP_MODE;
  const identityOrigin = requireServiceOrigin(
    environment.IDENTITY_SERVICE_ORIGIN,
    transportMode,
  );
  const planningOrigin = requireServiceOrigin(
    environment.PLANNING_SERVICE_ORIGIN,
    transportMode,
  );
""",
)
replace_once(
    gateway,
    '    habitOrigin = requireServiceOrigin(habitOriginValue);',
    """    habitOrigin = requireServiceOrigin(
      habitOriginValue,
      environment.SERVICE_ORIGIN_HTTP_MODE,
    );""",
)

red_path = Path('apps/web/app/service-origin-transport-red.test.ts')
green_path = Path('apps/web/app/service-origin-transport.test.ts')
if not red_path.exists() or green_path.exists():
    raise SystemExit('unexpected service-origin regression paths')
red_path.rename(green_path)
green_path.write_text(
    """import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireServiceOrigin } from './planning-search-client';

test('service origins fail closed on cleartext except explicit loopback mode', () => {
  assert.equal(
    requireServiceOrigin('https://identity.example.test'),
    'https://identity.example.test',
  );

  for (const origin of [
    'http://identity.example.test',
    'http://127.0.0.1:4101',
  ]) {
    assert.throws(
      () => requireServiceOrigin(origin),
      new Error('Service origin is invalid'),
    );
  }

  assert.equal(
    requireServiceOrigin('http://127.0.0.1:4101', 'loopback'),
    'http://127.0.0.1:4101',
  );
  assert.throws(
    () => requireServiceOrigin('http://identity.example.test', 'loopback'),
    new Error('Service origin is invalid'),
  );
});
""",
    encoding='utf-8',
)

Path('apps/web/app/ai-service-origin-transport.test.ts').write_text(
    """import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireAiServiceOrigin } from './ai-proposal-client';

test('AI service origins share the HTTPS-default transport policy', () => {
  assert.equal(
    requireAiServiceOrigin('https://ai.example.test'),
    'https://ai.example.test',
  );
  assert.throws(
    () => requireAiServiceOrigin('http://ai.example.test'),
    new Error('AI service origin is invalid'),
  );
  assert.equal(
    requireAiServiceOrigin('http://127.0.0.1:4105', 'loopback'),
    'http://127.0.0.1:4105',
  );
  assert.throws(
    () => requireAiServiceOrigin('http://ai-service:4105', 'loopback'),
    new Error('AI service origin is invalid'),
  );
});
""",
    encoding='utf-8',
)

Path('apps/gateway/src/service-origin-transport.test.ts').write_text(
    """import { describe, expect, it } from 'vitest';
import { composePlanningToday, GatewayTodayError } from './today-composition';

const SECRET = 'a'.repeat(32);

describe('Gateway service-origin transport', () => {
  it('rejects remote cleartext before sending credentials upstream', async () => {
    let calls = 0;
    await expect(
      composePlanningToday(
        'session=opaque',
        '2026-09-24',
        {
          IDENTITY_SERVICE_ORIGIN: 'http://identity.example.test',
          PLANNING_SERVICE_ORIGIN: 'https://planning.example.test',
          PLANNING_GATEWAY_CONTEXT_SECRET: SECRET,
        },
        async () => {
          calls += 1;
          throw new Error('fetch must not run');
        },
      ),
    ).rejects.toMatchObject<Partial<GatewayTodayError>>({
      status: 503,
      code: 'today_composition_unavailable',
    });
    expect(calls).toBe(0);
  });
});
""",
    encoding='utf-8',
)

replacements = {
    'http://identity-service:4101': 'https://identity-service:4101',
    'http://planning-service:4102': 'https://planning-service:4102',
    'http://ai-service:4105': 'https://ai-service:4105',
}
changed_fixture_files = 0
for path in Path('apps/web/app').rglob('*.test.ts'):
    if path.name in {'service-origin-transport.test.ts', 'ai-service-origin-transport.test.ts'}:
        continue
    text = path.read_text(encoding='utf-8')
    updated = text
    for old, new in replacements.items():
        updated = updated.replace(old, new)
    if updated != text:
        path.write_text(updated, encoding='utf-8')
        changed_fixture_files += 1
if changed_fixture_files < 4:
    raise SystemExit(
        f'expected at least four HTTPS fixture migrations, got {changed_fixture_files}'
    )
