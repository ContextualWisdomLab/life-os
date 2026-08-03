import { describe, expect, it } from 'vitest';
import { AesGcmSecretBox } from './secret-box';

const KEY_V1 = Buffer.from('11'.repeat(32), 'hex');
const KEY_V2 = Buffer.from('22'.repeat(32), 'hex');

function createSecretBox(): AesGcmSecretBox {
  return new AesGcmSecretBox({
    currentKeyVersion: 'v2',
    keys: {
      v1: KEY_V1,
      v2: KEY_V2,
    },
  });
}

describe('AesGcmSecretBox', () => {
  it('encrypts and decrypts a secret with authenticated context', () => {
    const box = createSecretBox();

    const encrypted = box.encrypt('pkce-verifier', 'oauth-transaction:tx-a:verifier');

    expect(encrypted.keyVersion).toBe('v2');
    expect(encrypted.payload).toBeInstanceOf(Buffer);
    expect(encrypted.payload.toString('utf8')).not.toContain('pkce-verifier');
    expect(box.decrypt(encrypted, 'oauth-transaction:tx-a:verifier')).toBe('pkce-verifier');
  });

  it('uses a fresh nonce for every encryption', () => {
    const box = createSecretBox();

    const first = box.encrypt('same-secret', 'same-context');
    const second = box.encrypt('same-secret', 'same-context');

    expect(first.payload.equals(second.payload)).toBe(false);
  });

  it('decrypts data written with an older configured key version', () => {
    const oldBox = new AesGcmSecretBox({
      currentKeyVersion: 'v1',
      keys: { v1: KEY_V1 },
    });
    const encrypted = oldBox.encrypt('rotatable-secret', 'rotation-context');

    expect(createSecretBox().decrypt(encrypted, 'rotation-context')).toBe('rotatable-secret');
  });

  it('fails closed when the ciphertext, context, or key version is invalid', () => {
    const box = createSecretBox();
    const encrypted = box.encrypt('sensitive', 'expected-context');
    const tampered = Buffer.from(encrypted.payload);
    const finalByteIndex = tampered.length - 1;
    tampered[finalByteIndex] = (tampered[finalByteIndex] ?? 0) ^ 0xff;

    expect(() =>
      box.decrypt({ ...encrypted, payload: tampered }, 'expected-context'),
    ).toThrowError('Secret decryption failed');
    expect(() => box.decrypt(encrypted, 'wrong-context')).toThrowError(
      'Secret decryption failed',
    );
    expect(() =>
      box.decrypt({ ...encrypted, keyVersion: 'unknown' }, 'expected-context'),
    ).toThrowError('Unknown encryption key version');
  });

  it('rejects invalid encryption key configuration', () => {
    expect(
      () =>
        new AesGcmSecretBox({
          currentKeyVersion: 'v1',
          keys: { v1: Buffer.alloc(16) },
        }),
    ).toThrowError('AES-256-GCM keys must be 32 bytes');

    expect(
      () =>
        new AesGcmSecretBox({
          currentKeyVersion: 'missing',
          keys: { v1: KEY_V1 },
        }),
    ).toThrowError('Current encryption key version is not configured');
  });
});
