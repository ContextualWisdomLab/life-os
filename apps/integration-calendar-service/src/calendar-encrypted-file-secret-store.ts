import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { chmod, lstat, mkdir, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CalendarConnectionCredentialStore,
  CalendarConnectionCredentialWrite,
} from './calendar-connection-create';
import type { CalendarCredentialSecretStore } from './calendar-credential-materializer';

const HANDLE_PREFIX = 'lifeos-calendar-secret://';
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANONICAL_256_BIT_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAXIMUM_DIRECTORY_LENGTH = 4_096;
const MAXIMUM_SECRET_LENGTH = 16_384;
const MAXIMUM_ENVELOPE_BYTES = 65_536;
const MAXIMUM_WRITE_ATTEMPTS = 4;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

interface CalendarEncryptedSecretPayload {
  readonly schemaVersion: 1;
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly credentialKind: 'access' | 'refresh';
  readonly secretValue: string;
}

interface CalendarEncryptedSecretEnvelope {
  readonly schemaVersion: 1;
  readonly algorithm: 'aes-256-gcm';
  readonly iv: string;
  readonly ciphertext: string;
  readonly authTag: string;
}

/**
 * Fixed, credential-free failure returned for every encrypted secret-store
 * validation, filesystem, parsing, or cryptographic error.
 */
export class CalendarEncryptedFileSecretStoreError extends Error {
  /** Creates the only externally observable failure for this storage adapter. */
  constructor() {
    super('Calendar encrypted secret storage is unavailable');
    this.name = 'CalendarEncryptedFileSecretStoreError';
  }
}

function unavailable(): never {
  throw new CalendarEncryptedFileSecretStoreError();
}

function requireDirectory(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAXIMUM_DIRECTORY_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return unavailable();
  }
  return value;
}

function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return unavailable();
  }
  return value.toLowerCase();
}

function requireSecret(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAXIMUM_SECRET_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return unavailable();
  }
  return value;
}

function requireCredentialKind(value: unknown): 'access' | 'refresh' {
  if (value !== 'access' && value !== 'refresh') {
    return unavailable();
  }
  return value;
}

function requireMasterKey(value: unknown): Buffer {
  if (
    typeof value !== 'string' ||
    !CANONICAL_256_BIT_KEY_PATTERN.test(value)
  ) {
    return unavailable();
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== value) {
    decoded.fill(0);
    return unavailable();
  }
  return decoded;
}

function requireCanonicalBase64(
  value: unknown,
  expectedBytes?: number,
): Buffer {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAXIMUM_ENVELOPE_BYTES * 2
  ) {
    return unavailable();
  }
  const decoded = Buffer.from(value, 'base64');
  if (
    decoded.length === 0 ||
    decoded.length > MAXIMUM_ENVELOPE_BYTES ||
    decoded.toString('base64') !== value ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes)
  ) {
    decoded.fill(0);
    return unavailable();
  }
  return decoded;
}

function parseHandle(
  value: unknown,
): { readonly handle: string; readonly id: string } {
  if (typeof value !== 'string' || !value.startsWith(HANDLE_PREFIX)) {
    return unavailable();
  }
  const rawId = value.slice(HANDLE_PREFIX.length);
  const id = requireUuidV4(rawId);
  const handle = `${HANDLE_PREFIX}${id}`;
  if (value !== handle) {
    return unavailable();
  }
  return Object.freeze({ handle, id });
}

function normalizeWrite(
  input: CalendarConnectionCredentialWrite,
): CalendarEncryptedSecretPayload {
  if (!input || typeof input !== 'object') {
    return unavailable();
  }
  return Object.freeze({
    schemaVersion: 1,
    connectionId: requireUuidV4(input.connectionId),
    workspaceId: requireUuidV4(input.workspaceId),
    userId: requireUuidV4(input.userId),
    credentialKind: requireCredentialKind(input.credentialKind),
    secretValue: requireSecret(input.secretValue),
  });
}

function requireEnvelope(value: unknown): CalendarEncryptedSecretEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return unavailable();
  }
  const candidate = value as Partial<CalendarEncryptedSecretEnvelope>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.algorithm !== 'aes-256-gcm' ||
    typeof candidate.iv !== 'string' ||
    typeof candidate.ciphertext !== 'string' ||
    typeof candidate.authTag !== 'string'
  ) {
    return unavailable();
  }
  return Object.freeze({
    schemaVersion: 1,
    algorithm: 'aes-256-gcm',
    iv: candidate.iv,
    ciphertext: candidate.ciphertext,
    authTag: candidate.authTag,
  });
}

function requirePayload(value: unknown): CalendarEncryptedSecretPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return unavailable();
  }
  const candidate = value as Partial<CalendarEncryptedSecretPayload>;
  if (candidate.schemaVersion !== 1) {
    return unavailable();
  }
  return Object.freeze({
    schemaVersion: 1,
    connectionId: requireUuidV4(candidate.connectionId),
    workspaceId: requireUuidV4(candidate.workspaceId),
    userId: requireUuidV4(candidate.userId),
    credentialKind: requireCredentialKind(candidate.credentialKind),
    secretValue: requireSecret(candidate.secretValue),
  });
}

function isErrnoCode(error: unknown, code: string): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === code
  );
}

/**
 * Self-hostable AES-256-GCM credential store for Calendar-owned secrets.
 *
 * Files contain only authenticated ciphertext envelopes. The opaque UUIDv4
 * handle is authenticated as GCM additional data, so moving ciphertext to a
 * different handle fails closed. This adapter implements both the connection
 * creation write/delete port and the credential materializer read port.
 */
export class CalendarEncryptedFileSecretStore
  implements CalendarConnectionCredentialStore, CalendarCredentialSecretStore
{
  private readonly directory: string;
  private readonly masterKey: Buffer;

  /** Creates a store rooted at an operator-owned directory with one 256-bit key. */
  constructor(directory: string, canonicalBase64Key: string) {
    this.directory = requireDirectory(directory);
    this.masterKey = requireMasterKey(canonicalBase64Key);
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
  }

  private pathForId(id: string): string {
    return join(this.directory, `${id}.json`);
  }

  /**
   * Encrypts one bounded credential and returns only a newly allocated opaque
   * handle. Existing files are never overwritten, including on UUID collision.
   */
  async writeSecret(input: CalendarConnectionCredentialWrite): Promise<string> {
    try {
      const safe = normalizeWrite(input);
      await this.ensureDirectory();

      for (let attempt = 0; attempt < MAXIMUM_WRITE_ATTEMPTS; attempt += 1) {
        const id = randomUUID();
        const handle = `${HANDLE_PREFIX}${id}`;
        const iv = randomBytes(IV_BYTES);
        const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv, {
          authTagLength: AUTH_TAG_BYTES,
        });
        cipher.setAAD(Buffer.from(handle, 'utf8'));

        const plaintext = Buffer.from(JSON.stringify(safe), 'utf8');
        let ciphertext: Buffer;
        let authTag: Buffer;
        try {
          ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
          authTag = cipher.getAuthTag();
        } finally {
          plaintext.fill(0);
        }

        const envelope: CalendarEncryptedSecretEnvelope = Object.freeze({
          schemaVersion: 1,
          algorithm: 'aes-256-gcm',
          iv: iv.toString('base64'),
          ciphertext: ciphertext.toString('base64'),
          authTag: authTag.toString('base64'),
        });
        iv.fill(0);
        ciphertext.fill(0);
        authTag.fill(0);

        try {
          await writeFile(this.pathForId(id), JSON.stringify(envelope), {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
          });
          return handle;
        } catch (error) {
          if (isErrnoCode(error, 'EEXIST')) {
            continue;
          }
          return unavailable();
        }
      }
      return unavailable();
    } catch {
      return unavailable();
    }
  }

  /**
   * Reads and authenticates one exact opaque handle, returning plaintext only
   * to the internal credential-materialization boundary. The opened file is
   * identity-checked against its preceding lstat and size-bounded before read.
   */
  async readSecret(secretHandle: string): Promise<string> {
    try {
      const parsed = parseHandle(secretHandle);
      const path = this.pathForId(parsed.id);
      const before = await lstat(path);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.size <= 0 ||
        before.size > MAXIMUM_ENVELOPE_BYTES
      ) {
        return unavailable();
      }

      const file = await open(path, 'r');
      let encoded: string;
      try {
        const opened = await file.stat();
        if (
          !opened.isFile() ||
          opened.size <= 0 ||
          opened.size > MAXIMUM_ENVELOPE_BYTES ||
          opened.dev !== before.dev ||
          opened.ino !== before.ino
        ) {
          return unavailable();
        }
        encoded = await file.readFile({ encoding: 'utf8' });
        if (Buffer.byteLength(encoded, 'utf8') !== opened.size) {
          return unavailable();
        }
      } finally {
        await file.close();
      }

      const envelope = requireEnvelope(JSON.parse(encoded) as unknown);
      const iv = requireCanonicalBase64(envelope.iv, IV_BYTES);
      const ciphertext = requireCanonicalBase64(envelope.ciphertext);
      const authTag = requireCanonicalBase64(envelope.authTag, AUTH_TAG_BYTES);

      const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv, {
        authTagLength: AUTH_TAG_BYTES,
      });
      decipher.setAAD(Buffer.from(parsed.handle, 'utf8'));
      decipher.setAuthTag(authTag);
      let plaintext: Buffer;
      try {
        plaintext = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);
      } finally {
        iv.fill(0);
        ciphertext.fill(0);
        authTag.fill(0);
      }

      try {
        if (plaintext.length === 0 || plaintext.length > MAXIMUM_ENVELOPE_BYTES) {
          return unavailable();
        }
        const payload = requirePayload(
          JSON.parse(plaintext.toString('utf8')) as unknown,
        );
        return payload.secretValue;
      } finally {
        plaintext.fill(0);
      }
    } catch {
      return unavailable();
    }
  }

  /** Deletes one exact handle idempotently; malformed handles fail closed. */
  async deleteSecret(secretHandle: string): Promise<void> {
    try {
      const parsed = parseHandle(secretHandle);
      await rm(this.pathForId(parsed.id), { force: true });
    } catch {
      return unavailable();
    }
  }
}

/**
 * Builds the encrypted Calendar secret store from explicit deployment
 * configuration. Missing or malformed configuration never falls back to
 * plaintext persistence or a generated process-local key.
 */
export function createCalendarEncryptedFileSecretStoreFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): CalendarEncryptedFileSecretStore {
  try {
    return new CalendarEncryptedFileSecretStore(
      requireDirectory(environment.CALENDAR_SECRET_STORE_DIRECTORY),
      typeof environment.CALENDAR_SECRET_STORE_KEY === 'string'
        ? environment.CALENDAR_SECRET_STORE_KEY
        : unavailable(),
    );
  } catch {
    return unavailable();
  }
}
