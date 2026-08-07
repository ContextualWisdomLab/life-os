import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const compose = readFileSync(resolve(ROOT, 'compose.privacy.yaml'), 'utf8');
const dockerfile = readFileSync(
  resolve(ROOT, 'apps/privacy-service/Dockerfile'),
  'utf8',
);

describe('privacy-service deployment contract', () => {
  it('keeps the service independently composable through one overlay', () => {
    expect(compose).toContain('privacy-service:');
    expect(compose).toContain('dockerfile: apps/privacy-service/Dockerfile');
    expect(compose).toContain(
      'PRIVACY_DATABASE_URL: ${PRIVACY_DATABASE_URL:?PRIVACY_DATABASE_URL is required}',
    );
    expect(compose).toContain('127.0.0.1:${PRIVACY_SERVICE_PORT:-4108}:4108');
    expect(compose).not.toContain('depends_on:');
    expect(compose).not.toContain('postgresql://lifeos:lifeos');
    expect(compose).not.toContain('network_mode: host');
    expect(compose).not.toContain('privileged: true');
  });

  it('requires separated grant, context, and audit key material', () => {
    for (const name of [
      'PRIVACY_GRANT_ACTIVE_KEY_ID',
      'PRIVACY_GRANT_ACTIVE_KEY_SECRET',
      'PRIVACY_CONTEXT_ACTIVE_KEY_ID',
      'PRIVACY_CONTEXT_ACTIVE_KEY_SECRET',
      'PRIVACY_AUDIT_DIGEST_KEY',
    ]) {
      expect(compose).toContain(`${name}: \${${name}:?`);
    }
    expect(compose.match(/PRIVACY_GRANT_ACTIVE_KEY_SECRET/gu)).toHaveLength(2);
    expect(compose.match(/PRIVACY_CONTEXT_ACTIVE_KEY_SECRET/gu)).toHaveLength(2);
    expect(compose.match(/PRIVACY_AUDIT_DIGEST_KEY/gu)).toHaveLength(2);
  });

  it('runs as a read-only non-root container with no Linux capabilities', () => {
    expect(compose).toContain('read_only: true');
    expect(compose).toContain('cap_drop:\n      - ALL');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('pids_limit: 128');
    expect(compose).toContain('/tmp:size=16m');
    expect(dockerfile).toContain('USER 10001:10001');
    expect(dockerfile).toContain('useradd --system --uid 10001');
    expect(dockerfile).not.toContain('USER root');
  });

  it('builds reproducibly and exposes only the bounded health contract', () => {
    expect(dockerfile).toContain('node:22.23.0-bookworm-slim');
    expect(dockerfile).toContain('pnpm install --frozen-lockfile');
    expect(dockerfile).toContain('pnpm --filter @life-os/privacy-service build');
    expect(dockerfile).toContain('CMD ["node", "dist/server.js"]');
    expect(compose).toContain(
      "fetch('http://127.0.0.1:4108/v1/privacy/health')",
    );
  });
});
