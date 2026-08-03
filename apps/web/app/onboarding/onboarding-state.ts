import {
  addTodayAction,
  parseTimeInput,
  scheduleTodayAction,
  type TodayDraft,
  toggleTodayPriority,
} from '../today-state';

export const ONBOARDING_STORAGE_KEY = 'life-os.onboarding.v1';
export const TODAY_STORAGE_KEY = 'life-os.today-draft.v1';
const COMPLETION_VERSION = 'life-os.onboarding.v1' as const;
const MAXIMUM_STORAGE_BYTES = 16 * 1024;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

export interface OnboardingCompletion {
  readonly version: typeof COMPLETION_VERSION;
  readonly completedAt: string;
  readonly weeklyFocus: string;
  readonly firstActionId: string;
  readonly placement: 'priority' | 'backlog';
}

export interface FirstRunPlanInput {
  readonly currentDraft: TodayDraft;
  readonly weeklyFocus: string;
  readonly actionTitle: string;
  readonly actionId: string;
  readonly createdAt: string;
  readonly startTime?: string;
  readonly durationMinutes?: number;
}

export interface FirstRunPlanResult {
  readonly draft: TodayDraft;
  readonly completion: OnboardingCompletion;
}

export class OnboardingValidationError extends Error {
  constructor() {
    super('Onboarding input is invalid');
    this.name = 'OnboardingValidationError';
  }
}

function invalid(): never {
  throw new OnboardingValidationError();
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireExactKeys(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): void {
  const actual = Object.keys(record);
  if (
    actual.length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key))
  ) {
    invalid();
  }
}

function requireString(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return invalid();
  }
  return normalized;
}

function requireUuidV4(value: unknown): string {
  const normalized = requireString(value, 36).toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function requireInstant(value: unknown): string {
  const normalized = requireString(value, 35);
  if (!INSTANT_PATTERN.test(normalized)) {
    return invalid();
  }
  const parsed = new Date(normalized);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== normalized
  ) {
    return invalid();
  }
  return normalized;
}

export function createFirstRunPlan(input: FirstRunPlanInput): FirstRunPlanResult {
  const weeklyFocus = requireString(input.weeklyFocus, 120);
  const actionTitle = requireString(input.actionTitle, 160);
  const actionId = requireUuidV4(input.actionId);
  const createdAt = requireInstant(input.createdAt);

  let draft = addTodayAction(input.currentDraft, {
    id: actionId,
    title: actionTitle,
    createdAt,
  });
  const priorityCount = draft.actions.filter(
    (action) => action.priority !== null,
  ).length;
  const placement = priorityCount < 3 ? 'priority' : 'backlog';

  if (placement === 'priority') {
    draft = toggleTodayPriority(draft, actionId);
    if (input.startTime !== undefined && input.startTime !== '') {
      const duration = input.durationMinutes ?? 60;
      draft = scheduleTodayAction(
        draft,
        actionId,
        parseTimeInput(input.startTime),
        duration,
      );
    }
  } else if (input.startTime) {
    return invalid();
  }

  return Object.freeze({
    draft,
    completion: Object.freeze({
      version: COMPLETION_VERSION,
      completedAt: createdAt,
      weeklyFocus,
      firstActionId: actionId,
      placement,
    }),
  });
}

export function parseStoredOnboardingCompletion(
  serialized: string | null,
): OnboardingCompletion | null {
  if (
    serialized === null ||
    byteLength(serialized) > MAXIMUM_STORAGE_BYTES
  ) {
    return null;
  }
  try {
    const record = requireRecord(JSON.parse(serialized) as unknown);
    requireExactKeys(record, [
      'version',
      'completedAt',
      'weeklyFocus',
      'firstActionId',
      'placement',
    ]);
    if (
      record.version !== COMPLETION_VERSION ||
      (record.placement !== 'priority' && record.placement !== 'backlog')
    ) {
      return invalid();
    }
    return Object.freeze({
      version: COMPLETION_VERSION,
      completedAt: requireInstant(record.completedAt),
      weeklyFocus: requireString(record.weeklyFocus, 120),
      firstActionId: requireUuidV4(record.firstActionId),
      placement: record.placement,
    });
  } catch {
    return null;
  }
}

export function serializeOnboardingCompletion(
  completion: OnboardingCompletion,
): string {
  const normalized = parseStoredOnboardingCompletion(
    JSON.stringify(completion),
  );
  if (!normalized) {
    return invalid();
  }
  const serialized = JSON.stringify(normalized);
  if (byteLength(serialized) > MAXIMUM_STORAGE_BYTES) {
    return invalid();
  }
  return serialized;
}
