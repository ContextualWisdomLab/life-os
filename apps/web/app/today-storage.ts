import {
  createEmptyTodayDraft,
  parseTodayDraft,
  type TodayDraft,
} from './today-state';

const MAXIMUM_STORAGE_BYTES = 128 * 1024;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function parseStoredTodayDraft(
  serialized: string | null,
  expectedDate: string,
): TodayDraft {
  if (serialized === null || byteLength(serialized) > MAXIMUM_STORAGE_BYTES) {
    return createEmptyTodayDraft(expectedDate);
  }
  try {
    return parseTodayDraft(JSON.parse(serialized) as unknown, expectedDate);
  } catch {
    return createEmptyTodayDraft(expectedDate);
  }
}

export function serializeTodayDraft(draft: TodayDraft): string {
  const normalized = parseTodayDraft(draft, draft.date);
  const serialized = JSON.stringify(normalized);
  if (byteLength(serialized) > MAXIMUM_STORAGE_BYTES) {
    throw new Error('Today draft exceeds the browser storage budget');
  }
  return serialized;
}
