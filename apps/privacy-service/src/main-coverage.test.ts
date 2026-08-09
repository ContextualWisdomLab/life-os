import { describe, expect, it } from 'vitest';
import {
  createPrivacyClock,
  createPrivacyRuntimeProvider,
  privacyApplicationFromRuntime,
  privacyContextKeyRingFromRuntime,
} from './main';
import { PrivacyRuntime } from './privacy-runtime';

const TEST_DATABASE_URL = [
  'postgresql:',
  '',
  'privacy_test_user@127.0.0.1:1',
  'privacy_test',
].join('/');
const GRANT_SECRET = Buffer.alloc(32, 0x51).toString('base64url');
const CONTEXT_SECRET = Buffer.alloc(32, 0x52).toString('base64url');
const AUDIT_SECRET = Buffer.alloc(32, 0x53).toString('base64url');

describe('privacy module provider factories', () => {
  it('creates the runtime from process-compatible environment input', async () => {
    const runtime = createPrivacyRuntimeProvider({
      PRIVACY_DATABASE_URL: TEST_DATABASE_URL,
      PRIVACY_DATABASE_CONNECT_TIMEOUT_MS: '100',
      PRIVACY_DATABASE_POOL_MAX: '1',
      PRIVACY_GRANT_ACTIVE_KEY_ID: 'grant-active',
      PRIVACY_GRANT_ACTIVE_KEY_SECRET: GRANT_SECRET,
      PRIVACY_CONTEXT_ACTIVE_KEY_ID: 'context-active',
      PRIVACY_CONTEXT_ACTIVE_KEY_SECRET: CONTEXT_SECRET,
      PRIVACY_AUDIT_DIGEST_KEY: AUDIT_SECRET,
    });
    expect(runtime).toBeInstanceOf(PrivacyRuntime);
    expect(privacyApplicationFromRuntime(runtime)).toBe(runtime.application);
    expect(privacyContextKeyRingFromRuntime(runtime)).toBe(
      runtime.contextKeyRing,
    );
    await runtime.close();
  });

  it('creates a fresh valid clock function', () => {
    const clock = createPrivacyClock();
    expect(clock).toBeInstanceOf(Function);
    const first = clock();
    const second = clock();
    expect(first).toBeInstanceOf(Date);
    expect(second).toBeInstanceOf(Date);
    expect(Number.isNaN(first.getTime())).toBe(false);
  });
});
