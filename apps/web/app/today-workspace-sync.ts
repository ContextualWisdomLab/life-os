import { parseTodayDraft, type TodayDraft } from './today-state';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAXIMUM_RESPONSE_BYTES = 64 * 1024;

type BrowserFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Valid durable Today document sent to the same-origin BFF. */
export interface DurableTodayDocument {
  readonly version: 'life-os.today.v1';
  readonly date: string;
  readonly actions: TodayDraft['actions'];
}

export type WorkspaceTodayReadResult =
  | { readonly kind: 'found'; readonly draft: TodayDraft; readonly revision: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'unavailable' };

export type WorkspaceTodaySaveResult =
  | { readonly kind: 'saved'; readonly draft: TodayDraft; readonly revision: string }
  | { readonly kind: 'conflict'; readonly currentRevision: string | null }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'unavailable' };

/** Converts validated browser-local state to the distinct durable wire version. */
export function toDurableTodayDocument(draft: TodayDraft): DurableTodayDocument {
  const safeDraft = parseTodayDraft(draft, draft.date);
  return Object.freeze({
    version: 'life-os.today.v1',
    date: safeDraft.date,
    actions: safeDraft.actions,
  });
}

/** Reads a response body only after enforcing an explicit byte cap. */
async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > MAXIMUM_RESPONSE_BYTES)
  ) {
    throw new Error('response too large');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0];
  if (
    contentType !== 'application/json' &&
    contentType !== 'application/problem+json'
  ) {
    throw new Error('unexpected media type');
  }
  if (!response.body) throw new Error('missing body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel('response too large');
        throw new Error('response too large');
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(body) as unknown;
}

/** Requires one strong UUIDv4 ETag and returns the unquoted opaque revision. */
function requireRevision(response: Response): string {
  const match = /^"([0-9a-f-]+)"$/iu.exec(response.headers.get('etag') ?? '');
  if (!match?.[1] || !UUID_V4_PATTERN.test(match[1])) {
    throw new Error('invalid revision');
  }
  return match[1].toLowerCase();
}

/** Converts one trusted-BFF durable response back to validated local draft state. */
function parseDurableToday(value: unknown, date: string): TodayDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid durable Today');
  }
  const record = value as Record<string, unknown>;
  const keys = ['version', 'aggregateId', 'revision', 'date', 'actions'];
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key)) ||
    record.version !== 'life-os.today.v1' ||
    record.date !== date ||
    typeof record.aggregateId !== 'string' ||
    !UUID_V4_PATTERN.test(record.aggregateId) ||
    typeof record.revision !== 'string' ||
    !UUID_V4_PATTERN.test(record.revision)
  ) {
    throw new Error('invalid durable Today');
  }
  return parseTodayDraft(
    {
      version: 'life-os.today-draft.v1',
      date,
      actions: record.actions,
    },
    date,
  );
}

/** Narrows the bounded BFF conflict shape to the current opaque revision token. */
async function parseConflict(response: Response): Promise<string | null | undefined> {
  const value = await readBoundedJson(response);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.type !== 'about:blank' ||
    record.title !== 'Today changed on another device' ||
    record.status !== 409 ||
    record.code !== 'today_revision_conflict'
  ) {
    return undefined;
  }
  if (record.currentRevision === null) return null;
  if (
    typeof record.currentRevision === 'string' &&
    UUID_V4_PATTERN.test(record.currentRevision)
  ) {
    return record.currentRevision.toLowerCase();
  }
  return undefined;
}

/** Explicitly checks whether a durable Today aggregate already exists. */
export async function fetchWorkspaceToday(
  date: string,
  fetcher: BrowserFetch = fetch,
): Promise<WorkspaceTodayReadResult> {
  try {
    const response = await fetcher(`/api/planning/today/${encodeURIComponent(date)}`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (response.status === 401) return { kind: 'unauthenticated' };
    if (response.status === 404) return { kind: 'missing' };
    if (response.status !== 200) return { kind: 'unavailable' };
    const revision = requireRevision(response);
    const draft = parseDurableToday(await readBoundedJson(response), date);
    return { kind: 'found', draft, revision };
  } catch {
    return { kind: 'unavailable' };
  }
}

/**
 * Explicitly saves browser-local state. A null revision means the user is
 * intentionally creating a missing durable aggregate; otherwise the last
 * observed strong revision is required so stale tabs cannot overwrite state.
 */
export async function saveWorkspaceToday(
  draft: TodayDraft,
  revision: string | null,
  fetcher: BrowserFetch = fetch,
): Promise<WorkspaceTodaySaveResult> {
  try {
    const document = toDurableTodayDocument(draft);
    if (revision !== null && !UUID_V4_PATTERN.test(revision)) {
      return { kind: 'unavailable' };
    }
    const requestHeaders = new Headers({
      accept: 'application/json',
      'content-type': 'application/json',
      'idempotency-key': globalThis.crypto.randomUUID(),
    });
    if (revision === null) requestHeaders.set('if-none-match', '*');
    else requestHeaders.set('if-match', `"${revision.toLowerCase()}"`);
    const response = await fetcher(
      `/api/planning/today/${encodeURIComponent(document.date)}`,
      {
        method: 'PUT',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: requestHeaders,
        body: JSON.stringify(document),
      },
    );
    if (response.status === 401) return { kind: 'unauthenticated' };
    if (response.status === 409) {
      const currentRevision = await parseConflict(response);
      return currentRevision === undefined
        ? { kind: 'unavailable' }
        : { kind: 'conflict', currentRevision };
    }
    if (response.status !== 200 && response.status !== 201) {
      return { kind: 'unavailable' };
    }
    const nextRevision = requireRevision(response);
    const nextDraft = parseDurableToday(
      await readBoundedJson(response),
      document.date,
    );
    return { kind: 'saved', draft: nextDraft, revision: nextRevision };
  } catch {
    return { kind: 'unavailable' };
  }
}
