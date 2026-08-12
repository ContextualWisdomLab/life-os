import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CalendarEncryptedFileSecretStore,
  CalendarEncryptedFileSecretStoreError,
  createCalendarEncryptedFileSecretStoreFromEnvironment,
} from './calendar-encrypted-file-secret-store';

const BASE64_KEY = Buffer.alloc(32, 0x2a).toString('base64');
const OTHER_BASE64_KEY = Buffer.alloc(32, 0x17).toString('base64');
const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'life-os-calendar-secret-'));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('CalendarEncryptedFileSecretStore', () => {
  it('encrypts credentials at rest and round-trips only through an opaque handle', async () => {
    const directory = await temporaryDirectory();
    const store = new CalendarEncryptedFileSecretStore(directory, BASE64_KEY);
    const secret = 'calendar-access-token-value';

    const handle = await store.writeSecret({
      connectionId: CONNECTION_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      credentialKind: 'access',
      secretValue: secret,
    });

    expect(handle).toMatch(
      /^lifeos-calendar-secret:\/\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    const secretId = handle.slice('lifeos-calendar-secret://'.length);
    const path = join(directory, `${secretId}.json`);
    const encoded = await readFile(path, 'utf8');
    expect(encoded).not.toContain(secret);
    expect((await stat(path)).mode & 0o077).toBe(0);
    await expect(store.readSecret(handle)).resolves.toBe(secret);
  });

  it('binds ciphertext to its opaque handle so file swapping fails closed', async () => {
    const directory = await temporaryDirectory();
    const store = new CalendarEncryptedFileSecretStore(directory, BASE64_KEY);
    const first = await store.writeSecret({
      connectionId: CONNECTION_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      credentialKind: 'access',
      secretValue: 'first-token',
    });
    const second = await store.writeSecret({
      connectionId: CONNECTION_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      credentialKind: 'refresh',
      secretValue: 'second-token',
    });
    const firstId = first.slice('lifeos-calendar-secret://'.length);
    const secondId = second.slice('lifeos-calendar-secret://'.length);
    const firstPath = join(directory, `${firstId}.json`);
    const secondPath = join(directory, `${secondId}.json`);

    await writeFile(firstPath, await readFile(secondPath), { mode: 0o600 });

    await expect(store.readSecret(first)).rejects.toBeInstanceOf(
      CalendarEncryptedFileSecretStoreError,
    );
  });

  it('rejects tampering and a different master key without exposing crypto details', async () => {
    const directory = await temporaryDirectory();
    const store = new CalendarEncryptedFileSecretStore(directory, BASE64_KEY);
    const handle = await store.writeSecret({
      connectionId: CONNECTION_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      credentialKind: 'access',
      secretValue: 'token-to-protect',
    });
    const secretId = handle.slice('lifeos-calendar-secret://'.length);
    const path = join(directory, `${secretId}.json`);
    const payload = JSON.parse(await readFile(path, 'utf8')) as {
      ciphertext: string;
    };
    payload.ciphertext = `${payload.ciphertext.slice(0, -2)}AA`;
    await writeFile(path, JSON.stringify(payload), { mode: 0o600 });

    await expect(store.readSecret(handle)).rejects.toMatchObject({
      name: 'CalendarEncryptedFileSecretStoreError',
      message: 'Calendar encrypted secret storage is unavailable',
    });

    const secondDirectory = await temporaryDirectory();
    const writer = new CalendarEncryptedFileSecretStore(
      secondDirectory,
      BASE64_KEY,
    );
    const secondHandle = await writer.writeSecret({
      connectionId: CONNECTION_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      credentialKind: 'access',
      secretValue: 'another-token',
    });
    const wrongKeyReader = new CalendarEncryptedFileSecretStore(
      secondDirectory,
      OTHER_BASE64_KEY,
    );
    await expect(wrongKeyReader.readSecret(secondHandle)).rejects.toBeInstanceOf(
      CalendarEncryptedFileSecretStoreError,
    );
  });

  it('deletes idempotently and rejects malformed handles without path traversal', async () => {
    const directory = await temporaryDirectory();
    const store = new CalendarEncryptedFileSecretStore(directory, BASE64_KEY);
    const handle = await store.writeSecret({
      connectionId: CONNECTION_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      credentialKind: 'access',
      secretValue: 'deletable-token',
    });

    await expect(store.deleteSecret(handle)).resolves.toBeUndefined();
    await expect(store.deleteSecret(handle)).resolves.toBeUndefined();
    await expect(store.readSecret(handle)).rejects.toBeInstanceOf(
      CalendarEncryptedFileSecretStoreError,
    );
    await expect(
      store.readSecret('lifeos-calendar-secret://../../etc/passwd'),
    ).rejects.toBeInstanceOf(CalendarEncryptedFileSecretStoreError);
  });

  it('fails closed on malformed environment configuration and accepts a canonical 256-bit key', async () => {
    const directory = await temporaryDirectory();
    expect(() =>
      createCalendarEncryptedFileSecretStoreFromEnvironment({
        CALENDAR_SECRET_STORE_DIRECTORY: directory,
        CALENDAR_SECRET_STORE_KEY: 'not-a-256-bit-key',
      }),
    ).toThrow(CalendarEncryptedFileSecretStoreError);

    const store = createCalendarEncryptedFileSecretStoreFromEnvironment({
      CALENDAR_SECRET_STORE_DIRECTORY: directory,
      CALENDAR_SECRET_STORE_KEY: BASE64_KEY,
    });
    const handle = await store.writeSecret({
      connectionId: CONNECTION_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      credentialKind: 'access',
      secretValue: 'configured-token',
    });
    await expect(store.readSecret(handle)).resolves.toBe('configured-token');
  });
});
