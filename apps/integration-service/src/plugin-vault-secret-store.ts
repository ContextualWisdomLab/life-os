import { timingSafeEqual } from 'node:crypto';
import type { PluginSecretStore, PutPluginSecretInput } from './plugin-credential';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CREDENTIAL_NAME_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/u;
const VAULT_MOUNT_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const CONTROL_OR_SPACE_PATTERN = /[\u0000-\u0020\u007f]/u;
const SECRET_REFERENCE_PREFIX = 'lifeos-plugin-vault://';
const MAXIMUM_SECRET_LENGTH = 8_192;
const MAXIMUM_TOKEN_LENGTH = 2_048;
const MAXIMUM_RESPONSE_BYTES = 65_536;
const REQUEST_TIMEOUT_MILLISECONDS = 5_000;

/** Exact authority and secret bytes written to one Vault KV v2 binding path. */
interface PluginVaultSecretPayload {
  readonly schemaVersion: 1;
  readonly credentialBindingId: string;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly installedByUserId: string;
  readonly credentialName: string;
  readonly secretValue: string;
}

/** Validated transport response plus the optional bounded body consumed for replay reconciliation. */
interface PluginVaultHttpResult {
  readonly response: PluginVaultHttpResponse;
  readonly body?: string;
}

/** Minimal response contract required from the Vault transport. */
export interface PluginVaultHttpResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
}

/** Fixed HTTPS request contract used by the Vault adapter and its deterministic tests. */
export interface PluginVaultHttpRequest {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly redirect: 'error';
  readonly signal: AbortSignal;
}

/** Injectable transport for one operator-configured Vault origin. */
export type PluginVaultHttpClient = (
  url: string,
  request: PluginVaultHttpRequest,
) => Promise<PluginVaultHttpResponse>;

/** Fixed, credential-free failure for configuration, transport, or durable evidence errors. */
export class PluginVaultSecretStoreError extends Error {
  /** Creates the only externally observable failure from this adapter. */
  constructor() {
    super('Plugin secret storage is unavailable');
    this.name = 'PluginVaultSecretStoreError';
  }
}

/** Terminates the current boundary with the fixed credential-free adapter error. */
function unavailable(): never {
  throw new PluginVaultSecretStoreError();
}

/** Accepts only canonical lowercase UUIDv4 authority; equivalent alternate spellings are rejected. */
function requireUuidV4(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !UUID_V4_PATTERN.test(value) ||
    value !== value.toLowerCase()
  ) {
    return unavailable();
  }
  return value;
}

/** Applies the canonical UUID contract specifically to Vault-returned durable authority evidence. */
function requireStoredUuid(value: unknown): string {
  return requireUuidV4(value);
}

/** Accepts one bounded plugin credential key that is safe to persist as non-secret metadata. */
function requireCredentialName(value: unknown): string {
  if (typeof value !== 'string' || !CREDENTIAL_NAME_PATTERN.test(value)) {
    return unavailable();
  }
  return value;
}

/** Accepts bounded non-empty secret text while rejecting control characters before provider I/O. */
function requireSecretValue(value: unknown): string {
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

/** Requires one canonical credential-free HTTPS origin with no path, query, fragment, or userinfo. */
function requireVaultOrigin(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) {
    return unavailable();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return unavailable();
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.origin !== value
  ) {
    return unavailable();
  }
  return parsed.origin;
}

/** Requires an operator-supplied Vault token that is bounded and contains no whitespace/control data. */
function requireVaultToken(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > MAXIMUM_TOKEN_LENGTH ||
    CONTROL_OR_SPACE_PATTERN.test(value)
  ) {
    return unavailable();
  }
  return value;
}

/** Restricts the configured KV v2 mount to one path segment controlled by the operator. */
function requireVaultMount(value: unknown): string {
  if (typeof value !== 'string' || !VAULT_MOUNT_PATTERN.test(value)) {
    return unavailable();
  }
  return value;
}

/** Converts one plugin write command into immutable, already-canonical Vault authority and secret evidence. */
function requirePayload(value: unknown): PluginVaultSecretPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return unavailable();
  }
  const input = value as PutPluginSecretInput;
  return Object.freeze({
    schemaVersion: 1,
    credentialBindingId: requireUuidV4(input.credentialBindingId),
    installationId: requireUuidV4(input.installationId),
    workspaceId: requireUuidV4(input.workspaceId),
    installedByUserId: requireUuidV4(input.installedByUserId),
    credentialName: requireCredentialName(input.credentialName),
    secretValue: requireSecretValue(input.secretValue),
  });
}

/** Parses only this adapter's canonical opaque binding reference and returns its binding UUID. */
function parseReference(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith(SECRET_REFERENCE_PREFIX)) {
    return unavailable();
  }
  const bindingId = requireUuidV4(value.slice(SECRET_REFERENCE_PREFIX.length));
  const canonical = `${SECRET_REFERENCE_PREFIX}${bindingId}`;
  if (value !== canonical) {
    return unavailable();
  }
  return bindingId;
}

/** Compares secret UTF-8 bytes without early content comparison and zeroizes temporary buffers. */
function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  try {
    return (
      leftBytes.length === rightBytes.length &&
      timingSafeEqual(leftBytes, rightBytes)
    );
  } finally {
    leftBytes.fill(0);
    rightBytes.fill(0);
  }
}

/** Accepts replay only when every immutable authority field and the secret bytes match exactly. */
function samePayload(
  durable: PluginVaultSecretPayload,
  expected: PluginVaultSecretPayload,
): boolean {
  return (
    durable.schemaVersion === expected.schemaVersion &&
    durable.credentialBindingId === expected.credentialBindingId &&
    durable.installationId === expected.installationId &&
    durable.workspaceId === expected.workspaceId &&
    durable.installedByUserId === expected.installedByUserId &&
    durable.credentialName === expected.credentialName &&
    sameSecret(durable.secretValue, expected.secretValue)
  );
}

/** Validates the Vault KV v2 read envelope before any durable winner becomes replay authority. */
function requireVaultReadPayload(value: unknown): PluginVaultSecretPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return unavailable();
  }
  const outer = value as { readonly data?: unknown };
  if (outer.data === null || typeof outer.data !== 'object' || Array.isArray(outer.data)) {
    return unavailable();
  }
  const data = outer.data as { readonly data?: unknown };
  if (data.data === null || typeof data.data !== 'object' || Array.isArray(data.data)) {
    return unavailable();
  }
  const payload = data.data as Partial<PluginVaultSecretPayload>;
  if (payload.schemaVersion !== 1) {
    return unavailable();
  }
  return Object.freeze({
    schemaVersion: 1,
    credentialBindingId: requireStoredUuid(payload.credentialBindingId),
    installationId: requireStoredUuid(payload.installationId),
    workspaceId: requireStoredUuid(payload.workspaceId),
    installedByUserId: requireStoredUuid(payload.installedByUserId),
    credentialName: requireCredentialName(payload.credentialName),
    secretValue: requireSecretValue(payload.secretValue),
  });
}

/** Performs the real fetch while preserving the adapter's redirect and abort policy. */
const defaultHttpClient: PluginVaultHttpClient = async (url, request) => {
  const response = await fetch(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: request.redirect,
    signal: request.signal,
  });
  return response;
};

/**
 * Plugin-owned HashiCorp Vault KV v2 secret-store adapter.
 *
 * The binding UUID determines one opaque, credential-free reference and one Vault
 * path. Create uses KV v2 check-and-set `cas: 0`, so concurrent writers cannot
 * overwrite an existing binding. If create completion is ambiguous or CAS loses,
 * the adapter reads the durable winner and accepts replay only when all authority
 * metadata and secret bytes exactly match. Different secret material for the same
 * binding therefore fails closed instead of becoming a provider-side overwrite.
 */
export class PluginVaultSecretStore implements PluginSecretStore {
  private readonly origin: string;
  private readonly token: string;
  private readonly mount: string;
  private readonly http: PluginVaultHttpClient;

  /** Creates an adapter for one canonical HTTPS Vault origin and KV v2 mount. */
  constructor(
    origin: string,
    token: string,
    mount = 'secret',
    http: PluginVaultHttpClient = defaultHttpClient,
  ) {
    this.origin = requireVaultOrigin(origin);
    this.token = requireVaultToken(token);
    this.mount = requireVaultMount(mount);
    if (typeof http !== 'function') {
      return unavailable();
    }
    this.http = http;
  }

  /**
   * Creates exactly one binding secret or returns the exact matching durable replay.
   * The returned reference contains only the binding UUID, never Vault token or plaintext.
   */
  async putSecret(input: PutPluginSecretInput): Promise<string> {
    const payload = requirePayload(input);
    const reference = `${SECRET_REFERENCE_PREFIX}${payload.credentialBindingId}`;
    const url = this.dataUrl(payload.credentialBindingId);
    const body = JSON.stringify({ options: { cas: 0 }, data: payload });

    let result: PluginVaultHttpResult;
    try {
      result = await this.request(url, 'POST', body);
    } catch {
      return this.reconcileCreate(payload, reference);
    }
    const { response } = result;
    if (response.status === 200 || response.status === 204) {
      return reference;
    }
    if (response.status === 400 || response.status === 409) {
      return this.reconcileCreate(payload, reference);
    }
    return unavailable();
  }

  /** Deletes all Vault KV versions for one exact opaque binding reference; missing is replay-safe. */
  async deleteSecret(secretReference: string): Promise<void> {
    const bindingId = parseReference(secretReference);
    const { response } = await this.request(this.metadataUrl(bindingId), 'DELETE');
    if (response.status === 200 || response.status === 204 || response.status === 404) {
      return;
    }
    return unavailable();
  }

  /** Re-reads one ambiguous/CAS-losing create and returns only an exact durable replay winner. */
  private async reconcileCreate(
    expected: PluginVaultSecretPayload,
    reference: string,
  ): Promise<string> {
    let result: PluginVaultHttpResult;
    try {
      result = await this.request(
        this.dataUrl(expected.credentialBindingId),
        'GET',
        undefined,
        true,
      );
    } catch {
      return unavailable();
    }
    if (result.response.status !== 200 || result.body === undefined) {
      return unavailable();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      return unavailable();
    }
    const durable = requireVaultReadPayload(parsed);
    if (!samePayload(durable, expected)) {
      return unavailable();
    }
    return reference;
  }

  /** Builds the one KV v2 data path owned by the credential-binding UUID. */
  private dataUrl(bindingId: string): string {
    return `${this.origin}/v1/${this.mount}/data/life-os/plugin-credentials/${bindingId}`;
  }

  /** Builds the matching KV v2 metadata path used for all-version deletion. */
  private metadataUrl(bindingId: string): string {
    return `${this.origin}/v1/${this.mount}/metadata/life-os/plugin-credentials/${bindingId}`;
  }

  /**
   * Executes one bounded Vault request and validates its response envelope.
   * `consumeSuccessfulBody` is reserved for the replay GET: status-only create/delete
   * paths cancel uninterpreted response bodies, while transport, read, and cleanup
   * completion all remain inside the same finite deadline.
   */
  private async request(
    url: string,
    method: 'GET' | 'POST' | 'DELETE',
    requestBody?: string,
    consumeSuccessfulBody = false,
  ): Promise<PluginVaultHttpResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MILLISECONDS);
    try {
      const response = await this.settleWithinDeadline(
        this.http(url, {
          method,
          headers: Object.freeze({
            accept: 'application/json',
            'content-type': 'application/json',
            'x-vault-token': this.token,
          }),
          ...(requestBody === undefined ? {} : { body: requestBody }),
          redirect: 'error',
          signal: controller.signal,
        }),
        controller.signal,
      );
      if (
        response === null ||
        typeof response !== 'object' ||
        !Number.isInteger(response.status) ||
        response.status < 100 ||
        response.status > 599 ||
        response.headers === null ||
        typeof response.headers !== 'object' ||
        typeof response.headers.get !== 'function'
      ) {
        return unavailable();
      }
      if (consumeSuccessfulBody && response.status === 200) {
        return {
          response,
          body: await this.boundedBody(response, controller.signal),
        };
      }
      await this.cancelUnusedBody(response, controller.signal);
      return { response };
    } catch {
      return unavailable();
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Cancels uninterpreted response bytes without letting cleanup outlive the request deadline. */
  private async cancelUnusedBody(
    response: PluginVaultHttpResponse,
    signal: AbortSignal,
  ): Promise<void> {
    if (response.body === null) {
      return;
    }
    if (
      typeof response.body !== 'object' ||
      typeof response.body.cancel !== 'function'
    ) {
      return unavailable();
    }
    try {
      await this.settleWithinDeadline(response.body.cancel(), signal);
    } catch {
      return unavailable();
    }
  }

  /**
   * Reads one replay body incrementally under the total request deadline and byte cap.
   * Every acquired reader is cancelled on abnormal preflight/read exit so underlying
   * transport resources are released; read chunks are zeroized before failure or decode.
   */
  private async boundedBody(
    response: PluginVaultHttpResponse,
    signal: AbortSignal,
  ): Promise<string> {
    if (
      response.body === null ||
      typeof response.body !== 'object' ||
      typeof response.body.getReader !== 'function'
    ) {
      return unavailable();
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let completed = false;
    try {
      const declaredLength = response.headers.get('content-length');
      if (declaredLength !== null) {
        if (!/^(?:0|[1-9]\d*)$/u.test(declaredLength)) {
          return unavailable();
        }
        const bytes = Number(declaredLength);
        if (!Number.isSafeInteger(bytes) || bytes > MAXIMUM_RESPONSE_BYTES) {
          return unavailable();
        }
      }
      while (true) {
        const result = await this.readWithAbort(reader, signal);
        if (result.done) {
          completed = true;
          break;
        }
        if (!(result.value instanceof Uint8Array)) {
          return unavailable();
        }
        chunks.push(result.value);
        totalBytes += result.value.byteLength;
        if (!Number.isSafeInteger(totalBytes) || totalBytes > MAXIMUM_RESPONSE_BYTES) {
          return unavailable();
        }
      }
    } catch {
      try {
        await this.settleWithinDeadline(reader.cancel(), signal);
      } catch {
        // Cancellation has still been initiated; the fixed public failure remains authoritative.
      }
      return unavailable();
    } finally {
      if (!completed) {
        for (const chunk of chunks) {
          chunk.fill(0);
        }
      }
      try {
        reader.releaseLock();
      } catch {
        // A pending/cancelled reader can already have released its lock.
      }
    }

    const bytes = Buffer.concat(chunks, totalBytes);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return unavailable();
    } finally {
      bytes.fill(0);
      for (const chunk of chunks) {
        chunk.fill(0);
      }
    }
  }

  /** Races one stream read against the request abort signal without leaving an abort listener behind. */
  private async readWithAbort(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal,
  ): Promise<ReadableStreamReadResult<Uint8Array>> {
    return this.settleWithinDeadline(reader.read(), signal);
  }

  /**
   * Accepts a transport step only if it settles before the shared request deadline.
   * A result delivered by the same abort that expires the deadline is still rejected.
   */
  private async settleWithinDeadline<T>(
    operation: Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    let abortListener: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(new PluginVaultSecretStoreError());
        if (signal.aborted) {
          abortListener();
          return;
        }
        signal.addEventListener('abort', abortListener, { once: true });
      });
      const result = await Promise.race([operation, aborted]);
      if (signal.aborted) {
        return unavailable();
      }
      return result;
    } finally {
      if (abortListener !== undefined) {
        signal.removeEventListener('abort', abortListener);
      }
    }
  }
}
