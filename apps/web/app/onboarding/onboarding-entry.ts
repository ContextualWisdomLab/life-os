import {
  parseStoredTodayDraft,
  serializeTodayDraft,
} from '../today-storage';

export const TODAY_STORAGE_KEY = 'life-os.today-draft.v1';
export const ONBOARDING_COMPLETION_STORAGE_KEY =
  'life-os.onboarding-completion.v1';
export const ONBOARDING_DISMISSAL_STORAGE_KEY =
  'life-os.onboarding-dismissal.v1';

const MAXIMUM_MARKER_BYTES = 4 * 1024;
const INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})Z$/;

interface OnboardingEntryState {
  readonly todaySerialized: string | null;
  readonly completionSerialized: string | null;
  readonly dismissalSerialized: string | null;
  readonly date: string;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isExactMarker(
  serialized: string | null,
  expectedVersion: string,
  timestampKey: 'completedAt' | 'dismissedAt',
): boolean {
  if (
    serialized === null ||
    byteLength(serialized) > MAXIMUM_MARKER_BYTES
  ) {
    return false;
  }
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return false;
    }
    const record = parsed as Readonly<Record<string, unknown>>;
    const keys = Object.keys(record).sort();
    if (
      keys.length !== 2 ||
      keys[0] !== timestampKey ||
      keys[1] !== 'version' ||
      record.version !== expectedVersion ||
      typeof record[timestampKey] !== 'string' ||
      !INSTANT_PATTERN.test(record[timestampKey])
    ) {
      return false;
    }
    const timestamp = new Date(record[timestampKey]);
    return (
      Number.isFinite(timestamp.getTime()) &&
      timestamp.toISOString() === record[timestampKey]
    );
  } catch {
    return false;
  }
}

/** Serializes a bounded marker that records an intentional onboarding skip. */
export function serializeOnboardingDismissal(recordedAt: string): string {
  if (
    !INSTANT_PATTERN.test(recordedAt) ||
    new Date(recordedAt).toISOString() !== recordedAt
  ) {
    throw new Error('Onboarding dismissal timestamp is invalid');
  }
  return JSON.stringify({
    version: ONBOARDING_DISMISSAL_STORAGE_KEY,
    dismissedAt: recordedAt,
  });
}

/**
 * Determines whether a browser should enter onboarding without overwriting
 * existing, malformed, dismissed, or already completed local state.
 */
export function shouldEnterOnboarding(state: OnboardingEntryState): boolean {
  if (
    isExactMarker(
      state.completionSerialized,
      ONBOARDING_COMPLETION_STORAGE_KEY,
      'completedAt',
    ) ||
    isExactMarker(
      state.dismissalSerialized,
      ONBOARDING_DISMISSAL_STORAGE_KEY,
      'dismissedAt',
    )
  ) {
    return false;
  }

  const draft = parseStoredTodayDraft(state.todaySerialized, state.date);
  if (state.todaySerialized !== null) {
    try {
      if (serializeTodayDraft(draft) !== state.todaySerialized) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return draft.actions.length === 0;
}
