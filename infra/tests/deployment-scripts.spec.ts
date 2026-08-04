import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd(), '../..');
const kubernetesRoot = resolve(repositoryRoot, 'infra/kubernetes');

/** Execute one deployment Python helper with a bounded test timeout. */
function python(
  script: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
) {
  return spawnSync('python', [resolve(kubernetesRoot, script), ...arguments_], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
    timeout: 10_000,
  });
}

/** Build a synthetic PostgreSQL URI without committing a connection-string literal. */
function databaseUri(query: Readonly<Record<string, string>> = {}): string {
  const scheme = ['post', 'gresql'].join('');
  const parameters = new URLSearchParams(query);
  const queryString = parameters.size > 0 ? `?${parameters.toString()}` : '';
  return `${scheme}://life_user:${encodeURIComponent('p@ss')}@db.example:5433/life_os${queryString}`;
}

describe('PostgreSQL service-file writer', () => {
  it('parses a URI into a private service file without retaining the URI', () => {
    const directory = mkdtempSync(join(tmpdir(), 'life-os-pg-service-'));
    const output = join(directory, 'pg_service.conf');
    const databaseUrl = databaseUri({
      sslmode: 'require',
      connect_timeout: '5',
    });

    const result = python(
      'write-pg-service.py',
      [
        '--environment-variable',
        'TEST_DATABASE_URL',
        '--service-name',
        'planning_service',
        '--output',
        output,
      ],
      { TEST_DATABASE_URL: databaseUrl },
    );

    expect(result.status, result.stderr).toBe(0);
    const serviceFile = readFileSync(output, 'utf8');
    expect(serviceFile).toContain('[planning_service]');
    expect(serviceFile).toContain('host=db.example');
    expect(serviceFile).toContain('port=5433');
    expect(serviceFile).toContain('dbname=life_os');
    expect(serviceFile).toContain('user=life_user');
    expect(serviceFile).toContain('password=p@ss');
    expect(serviceFile).toContain('sslmode=require');
    expect(serviceFile).toContain('connect_timeout=5');
    expect(serviceFile).not.toContain(databaseUrl);
    expect(statSync(output).mode & 0o777).toBe(0o600);
  });

  it('rejects connection parameters outside the reviewed allowlist', () => {
    const directory = mkdtempSync(join(tmpdir(), 'life-os-pg-service-'));
    const output = join(directory, 'pg_service.conf');
    const result = python(
      'write-pg-service.py',
      [
        '--environment-variable',
        'TEST_DATABASE_URL',
        '--service-name',
        'planning_service',
        '--output',
        output,
      ],
      { TEST_DATABASE_URL: databaseUri({ service: 'unexpected' }) },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'unsupported PostgreSQL URI parameter: service',
    );
  });
});

describe('production manifest renderer', () => {
  it('renders approved immutable inputs through the supplied kubectl binary', () => {
    const directory = mkdtempSync(join(tmpdir(), 'life-os-render-'));
    const fakeKubectl = join(directory, 'kubectl');
    const renderRoot = join(directory, 'rendered-tree');
    const output = join(directory, 'production.yaml');
    writeFileSync(
      fakeKubectl,
      '#!/usr/bin/env bash\nset -Eeuo pipefail\nroot="$(dirname "$(dirname "$2")")"\ncat "${root}/base/edge-workloads.yaml"\n',
      'utf8',
    );
    chmodSync(fakeKubectl, 0o700);

    const result = python(
      'render-production-manifest.py',
      [
        '--source-root',
        kubernetesRoot,
        '--render-root',
        renderRoot,
        '--output',
        output,
        '--kubectl',
        fakeKubectl,
      ],
      {
        WEB_IMAGE: `ghcr.io/contextualwisdomlab/life-os-web@sha256:${'1'.repeat(64)}`,
        GATEWAY_IMAGE: `ghcr.io/contextualwisdomlab/life-os-gateway@sha256:${'2'.repeat(64)}`,
        WEB_ORIGIN: 'https://life.example',
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const manifest = readFileSync(output, 'utf8');
    expect(manifest).toContain(`sha256:${'1'.repeat(64)}`);
    expect(manifest).toContain(`sha256:${'2'.repeat(64)}`);
    expect(manifest).toContain('https://life.example');
    expect(manifest).not.toContain(`sha256:${'0'.repeat(64)}`);
    expect(manifest).not.toContain('life-os.invalid');
  });

  it('rejects an immutable image outside the approved repository path', () => {
    const directory = mkdtempSync(join(tmpdir(), 'life-os-render-'));
    const result = python(
      'render-production-manifest.py',
      [
        '--source-root',
        kubernetesRoot,
        '--render-root',
        join(directory, 'rendered-tree'),
        '--output',
        join(directory, 'production.yaml'),
      ],
      {
        WEB_IMAGE: `ghcr.io/other/life-os-web@sha256:${'1'.repeat(64)}`,
        GATEWAY_IMAGE: `ghcr.io/contextualwisdomlab/life-os-gateway@sha256:${'2'.repeat(64)}`,
        WEB_ORIGIN: 'https://life.example',
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'image reference must use the approved LifeOS GHCR path and sha256 digest',
    );
  });
});
