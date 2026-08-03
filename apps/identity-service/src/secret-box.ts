import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const AES_256_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const MINIMUM_PAYLOAD_BYTES = GCM_NONCE_BYTES + GCM_TAG_BYTES;

export interface EncryptedSecret {
  keyVersion: string;
  payload: Buffer;
}

export interface SecretBoxConfiguration {
  currentKeyVersion: string;
  keys: Readonly<Record<string, Buffer>>;
}

function requireContext(value: string): Buffer {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Authenticated encryption context is required');
  }
  return Buffer.from(value, 'utf8');
}

export class AesGcmSecretBox {
  private readonly currentKeyVersion: string;
  private readonly keys: ReadonlyMap<string, Buffer>;

  constructor(configuration: SecretBoxConfiguration) {
    const entries = Object.entries(configuration.keys);
    for (const [, key] of entries) {
      if (!Buffer.isBuffer(key) || key.length !== AES_256_KEY_BYTES) {
        throw new Error('AES-256-GCM keys must be 32 bytes');
      }
    }

    const currentKeyVersion = configuration.currentKeyVersion.trim();
    if (!currentKeyVersion || !configuration.keys[currentKeyVersion]) {
      throw new Error('Current encryption key version is not configured');
    }

    this.currentKeyVersion = currentKeyVersion;
    this.keys = new Map(entries.map(([version, key]) => [version, Buffer.from(key)]));
  }

  encrypt(secret: string, context: string): EncryptedSecret {
    if (typeof secret !== 'string') {
      throw new Error('Secret must be a string');
    }

    const key = this.keys.get(this.currentKeyVersion);
    if (!key) {
      throw new Error('Current encryption key version is not configured');
    }

    const nonce = randomBytes(GCM_NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, nonce, {
      authTagLength: GCM_TAG_BYTES,
    });
    cipher.setAAD(requireContext(context));
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();

    return {
      keyVersion: this.currentKeyVersion,
      payload: Buffer.concat([nonce, authenticationTag, ciphertext]),
    };
  }

  decrypt(encrypted: EncryptedSecret, context: string): string {
    const key = this.keys.get(encrypted.keyVersion);
    if (!key) {
      throw new Error('Unknown encryption key version');
    }

    try {
      if (!Buffer.isBuffer(encrypted.payload) || encrypted.payload.length < MINIMUM_PAYLOAD_BYTES) {
        throw new Error('Malformed encrypted payload');
      }

      const nonce = encrypted.payload.subarray(0, GCM_NONCE_BYTES);
      const authenticationTag = encrypted.payload.subarray(
        GCM_NONCE_BYTES,
        GCM_NONCE_BYTES + GCM_TAG_BYTES,
      );
      const ciphertext = encrypted.payload.subarray(GCM_NONCE_BYTES + GCM_TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', key, nonce, {
        authTagLength: GCM_TAG_BYTES,
      });
      decipher.setAAD(requireContext(context));
      decipher.setAuthTag(authenticationTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Secret decryption failed');
    }
  }
}
