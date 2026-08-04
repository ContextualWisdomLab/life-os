import { describe, expect, it } from 'vitest';
import {
  AiGatewayKeyConfigurationError,
  AiGatewayKeySelectionError,
  requireAiGatewayContextKeyRing,
  requireAiGatewayKeyId,
  requireAiGatewayKeySecret,
  selectAiGatewayVerificationKey,
} from './ai-gateway-keyring';

const ACTIVE_ID = 'gateway-2026-08-a';
const PREVIOUS_ID = 'gateway-2026-07-z';
const ACTIVE_SECRET = Buffer.alloc(32, 0x41).toString('base64url');
const PREVIOUS_SECRET = Buffer.alloc(32, 0x42).toString('base64url');

/** Creates one complete active-only environment. */
function activeEnvironment(): {
  AI_GATEWAY_ACTIVE_KEY_ID: string;
  AI_GATEWAY_ACTIVE_KEY_SECRET: string;
} {
  return {
    AI_GATEWAY_ACTIVE_KEY_ID: ACTIVE_ID,
    AI_GATEWAY_ACTIVE_KEY_SECRET: ACTIVE_SECRET,
  };
}

describe('AI gateway key configuration', () => {
  it.each(['a', 'A_1', 'release.2026-08', 'gateway-key']) (
    'accepts bounded opaque key identifier %s',
    (keyId) => {
      expect(requireAiGatewayKeyId(keyId)).toBe(keyId);
    },
  );

  it.each([
    undefined,
    null,
    '',
    '-leading',
    'white space',
    'a'.repeat(65),
    'line\nbreak',
  ])('rejects malformed key identifier %#', (value) => {
    expect(() => requireAiGatewayKeyId(value)).toThrow(
      AiGatewayKeyConfigurationError,
    );
  });

  it('accepts bounded independently generated secret material', () => {
    expect(requireAiGatewayKeySecret(ACTIVE_SECRET)).toBe(ACTIVE_SECRET);
    expect(requireAiGatewayKeySecret('é'.repeat(16))).toBe('é'.repeat(16));
  });

  it.each([
    undefined,
    null,
    '',
    'short',
    'x'.repeat(4097),
    `x${String.fromCharCode(0)}${'y'.repeat(31)}`,
    `${'x'.repeat(31)}\n`,
    `${'x'.repeat(31)}\r`,
  ])('rejects invalid secret material without echoing it: %#', (value) => {
    let failure: unknown;
    try {
      requireAiGatewayKeySecret(value);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AiGatewayKeyConfigurationError);
    expect(String(failure)).not.toContain(String(value));
  });

  it('creates an immutable active-only keyring', () => {
    const keyRing = requireAiGatewayContextKeyRing(activeEnvironment());

    expect(keyRing).toEqual({
      active: { keyId: ACTIVE_ID, secret: ACTIVE_SECRET },
    });
    expect(Object.isFrozen(keyRing)).toBe(true);
    expect(Object.isFrozen(keyRing.active)).toBe(true);
  });

  it('creates one immutable active and previous overlap keyring', () => {
    const keyRing = requireAiGatewayContextKeyRing({
      ...activeEnvironment(),
      AI_GATEWAY_PREVIOUS_KEY_ID: PREVIOUS_ID,
      AI_GATEWAY_PREVIOUS_KEY_SECRET: PREVIOUS_SECRET,
    });

    expect(keyRing.previous).toEqual({
      keyId: PREVIOUS_ID,
      secret: PREVIOUS_SECRET,
    });
    expect(Object.isFrozen(keyRing.previous)).toBe(true);
  });

  it.each([
    {
      ...activeEnvironment(),
      AI_GATEWAY_PREVIOUS_KEY_ID: PREVIOUS_ID,
    },
    {
      ...activeEnvironment(),
      AI_GATEWAY_PREVIOUS_KEY_SECRET: PREVIOUS_SECRET,
    },
    {
      ...activeEnvironment(),
      AI_GATEWAY_PREVIOUS_KEY_ID: ACTIVE_ID,
      AI_GATEWAY_PREVIOUS_KEY_SECRET: PREVIOUS_SECRET,
    },
    {
      AI_GATEWAY_ACTIVE_KEY_ID: ACTIVE_ID,
    },
    {
      AI_GATEWAY_ACTIVE_KEY_SECRET: ACTIVE_SECRET,
    },
  ])('rejects incomplete or conflicting keyring configuration %#', (environment) => {
    expect(() => requireAiGatewayContextKeyRing(environment)).toThrow(
      AiGatewayKeyConfigurationError,
    );
  });
});

describe('AI gateway verification key selection', () => {
  const activeOnly = requireAiGatewayContextKeyRing(activeEnvironment());
  const overlap = requireAiGatewayContextKeyRing({
    ...activeEnvironment(),
    AI_GATEWAY_PREVIOUS_KEY_ID: PREVIOUS_ID,
    AI_GATEWAY_PREVIOUS_KEY_SECRET: PREVIOUS_SECRET,
  });

  it('selects only the exact active key identifier', () => {
    expect(selectAiGatewayVerificationKey(activeOnly, ACTIVE_ID)).toBe(
      activeOnly.active,
    );
    expect(() =>
      selectAiGatewayVerificationKey(activeOnly, ACTIVE_ID.toUpperCase()),
    ).toThrow(AiGatewayKeySelectionError);
  });

  it('selects the explicitly identified previous overlap key', () => {
    expect(selectAiGatewayVerificationKey(overlap, PREVIOUS_ID)).toBe(
      overlap.previous,
    );
  });

  it.each([
    undefined,
    null,
    '',
    '-leading',
    'unknown-key',
    'a'.repeat(65),
  ])('rejects malformed, unknown, or retired identifier %#', (value) => {
    let failure: unknown;
    try {
      selectAiGatewayVerificationKey(overlap, value);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AiGatewayKeySelectionError);
    expect(String(failure)).not.toContain(String(value));
  });
});
