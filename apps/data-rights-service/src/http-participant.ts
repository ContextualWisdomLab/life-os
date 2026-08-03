import {
  DataRightsDependencyError,
  type DataRightsDomain,
  type DataRightsParticipant,
  type DeletionConfirmation,
  type DeletionPreparation,
} from './data-rights';

const DEFAULT_TIMEOUT_MILLISECONDS = 5_000;
const MAXIMUM_RESPONSE_BYTES = 10 * 1024 * 1024;

/** Production configuration for one internal data-rights participant. */
export interface HttpDataRightsParticipantConfiguration {
  readonly domain: DataRightsDomain;
  readonly schemaVersion: string;
  readonly baseUrl: string;
  readonly authorization: string;
  readonly allowedHosts: readonly string[];
  readonly timeoutMilliseconds?: number;
  readonly fetchImplementation?: typeof fetch;
}

function requireAuthorization(value: string): string {
  if (!value || value.length > 4_096 || /[\r\n]/.test(value)) {
    throw new Error('Invalid participant authorization configuration');
  }
  return value;
}

function requireBaseUrl(value: string, allowedHosts: readonly string[]): URL {
  const allowed = new Set(allowedHosts.map((host) => host.trim().toLowerCase()));
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid participant URL configuration');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    !allowed.size ||
    !allowed.has(parsed.hostname.toLowerCase())
  ) {
    throw new Error('Invalid participant URL configuration');
  }
  parsed.search = '';
  parsed.hash = '';
  if (!parsed.pathname.endsWith('/')) {
    parsed.pathname = `${parsed.pathname}/`;
  }
  return parsed;
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  if (!response.body) {
    throw new DataRightsDependencyError();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      const chunk = result.value;
      receivedBytes += chunk.byteLength;
      if (receivedBytes > MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel();
        throw new DataRightsDependencyError();
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type');
  if (!contentType?.toLowerCase().startsWith('application/json')) {
    await response.body?.cancel();
    throw new DataRightsDependencyError();
  }
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAXIMUM_RESPONSE_BYTES)
  ) {
    await response.body?.cancel();
    throw new DataRightsDependencyError();
  }
  const body = await readBoundedBody(response);
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    throw new DataRightsDependencyError();
  }
}

/** HTTPS-only internal adapter with bounded requests and no destructive generic API. */
export class HttpDataRightsParticipant implements DataRightsParticipant {
  readonly domain: DataRightsDomain;
  readonly schemaVersion: string;
  private readonly baseUrl: URL;
  private readonly authorization: string;
  private readonly timeoutMilliseconds: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(configuration: HttpDataRightsParticipantConfiguration) {
    this.domain = configuration.domain;
    this.schemaVersion = configuration.schemaVersion;
    this.baseUrl = requireBaseUrl(
      configuration.baseUrl,
      configuration.allowedHosts,
    );
    this.authorization = requireAuthorization(configuration.authorization);
    this.timeoutMilliseconds =
      configuration.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
    if (
      !Number.isInteger(this.timeoutMilliseconds) ||
      this.timeoutMilliseconds < 100 ||
      this.timeoutMilliseconds > 30_000
    ) {
      throw new Error('Invalid participant timeout configuration');
    }
    this.fetchImplementation = configuration.fetchImplementation ?? fetch;
  }

  async exportWorkspace(workspaceId: string): Promise<readonly unknown[]> {
    const value = await this.requestJson('internal/v1/data-rights/export', {
      method: 'GET',
      headers: this.headers(workspaceId),
    });
    if (!Array.isArray(value)) {
      throw new DataRightsDependencyError();
    }
    return value;
  }

  async prepareDeletion(
    workspaceId: string,
    requestId: string,
  ): Promise<DeletionPreparation> {
    return (await this.requestJson(
      'internal/v1/data-rights/prepare-deletion',
      {
        method: 'POST',
        headers: this.headers(workspaceId, true),
        body: JSON.stringify({ requestId }),
      },
    )) as DeletionPreparation;
  }

  async commitDeletion(
    preparation: DeletionPreparation,
  ): Promise<DeletionConfirmation> {
    return (await this.requestJson(
      'internal/v1/data-rights/commit-deletion',
      {
        method: 'POST',
        headers: this.headers(preparation.workspaceId, true),
        body: JSON.stringify({
          requestId: preparation.requestId,
          token: preparation.token,
        }),
      },
    )) as DeletionConfirmation;
  }

  private headers(
    workspaceId: string,
    includeContentType = false,
  ): Record<string, string> {
    return {
      accept: 'application/json',
      authorization: this.authorization,
      'x-workspace-id': workspaceId,
      ...(includeContentType ? { 'content-type': 'application/json' } : {}),
    };
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMilliseconds);
    try {
      const response = await this.fetchImplementation(
        new URL(path, this.baseUrl),
        {
          ...init,
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new DataRightsDependencyError();
      }
      return await readBoundedJson(response);
    } catch (error) {
      if (error instanceof DataRightsDependencyError) {
        throw error;
      }
      throw new DataRightsDependencyError();
    } finally {
      clearTimeout(timer);
    }
  }
}
