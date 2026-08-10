import { randomUUID } from 'node:crypto';

export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface DailyRecurrence {
  kind: 'daily';
  interval: number;
}

export interface WeeklyRecurrence {
  kind: 'weekly';
  interval: number;
  weekdays: readonly IsoWeekday[];
}

export type HabitRecurrence = DailyRecurrence | WeeklyRecurrence;

export interface Habit {
  id: string;
  workspaceId: string;
  title: string;
  timezone: string;
  startsOn: string;
  recurrence: HabitRecurrence;
  createdAt: string;
}

export interface HabitOccurrence {
  habitId: string;
  workspaceId: string;
  scheduledLocalDate: string;
}

export interface HabitCompletionEvent {
  id: string;
  workspaceId: string;
  habitId: string;
  scheduledLocalDate: string;
  completedAt: string;
  idempotencyKey: string;
  recordedAt: string;
}

/** Habit-owned evidence needed to render one local-date Today view. */
export interface HabitTodayStatus {
  habitId: string;
  title: string;
  scheduledLocalDate: string;
  completed: boolean;
  completionId?: string;
}

export interface HabitRepository {
  saveHabit(habit: Habit): Promise<void>;
  findHabit(workspaceId: string, habitId: string): Promise<Habit | undefined>;
  listHabits(workspaceId: string): Promise<Habit[]>;
  appendCompletion(
    completion: HabitCompletionEvent,
  ): Promise<HabitCompletionEvent>;
  listCompletions(
    workspaceId: string,
    habitId: string,
  ): Promise<HabitCompletionEvent[]>;
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAXIMUM_OCCURRENCE_RANGE_DAYS = 366;
const MILLISECONDS_PER_DAY = 86_400_000;

interface ParsedLocalDate {
  text: string;
  epochDay: number;
  isoWeekday: IsoWeekday;
}

function requireOpaqueId(value: string): string {
  const normalized = value.trim();
  if (!normalized || /^\d+$/.test(normalized)) {
    throw new Error('Identifier must be an opaque non-numeric string');
  }
  return normalized;
}

function requireUuidV4(value: string): string {
  if (!UUID_V4_PATTERN.test(value)) {
    throw new Error('Idempotency key must be a UUIDv4');
  }
  return value.toLowerCase();
}

function requireTitle(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Title is required');
  }
  return normalized;
}

function requireTimezone(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Timezone is required');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format();
  } catch {
    throw new Error('Timezone is invalid');
  }
  return normalized;
}

function requireInterval(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 365) {
    throw new Error('Recurrence interval must be between 1 and 365');
  }
  return value;
}

function requireTimestamp(value: string): string {
  if (!RFC_3339_TIMESTAMP_PATTERN.test(value)) {
    throw new Error('Timestamp is invalid');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Timestamp is invalid');
  }
  return parsed.toISOString();
}

function parseLocalDate(value: string): ParsedLocalDate {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) {
    throw new Error('Local date must use YYYY-MM-DD');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const milliseconds = Date.UTC(year, month - 1, day);
  const date = new Date(milliseconds);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('Local date is invalid');
  }
  const utcWeekday = date.getUTCDay();
  const isoWeekday = (utcWeekday === 0 ? 7 : utcWeekday) as IsoWeekday;
  return {
    text: value,
    epochDay: milliseconds / MILLISECONDS_PER_DAY,
    isoWeekday,
  };
}

function localDateFromEpochDay(epochDay: number): ParsedLocalDate {
  const date = new Date(epochDay * MILLISECONDS_PER_DAY);
  const text = [
    date.getUTCFullYear().toString().padStart(4, '0'),
    (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    date.getUTCDate().toString().padStart(2, '0'),
  ].join('-');
  return parseLocalDate(text);
}

function normalizeWeekdays(values: readonly number[]): readonly IsoWeekday[] {
  if (values.length === 0) {
    throw new Error('Weekly recurrence requires at least one weekday');
  }
  const normalized = [...new Set(values)].sort((left, right) => left - right);
  if (
    normalized.some(
      (value) => !Number.isSafeInteger(value) || value < 1 || value > 7,
    )
  ) {
    throw new Error('Weekday must be between 1 and 7');
  }
  return normalized as IsoWeekday[];
}

function normalizeRecurrence(recurrence: HabitRecurrence): HabitRecurrence {
  const interval = requireInterval(recurrence.interval);
  if (recurrence.kind === 'daily') {
    return { kind: 'daily', interval };
  }
  if (recurrence.kind === 'weekly') {
    return {
      kind: 'weekly',
      interval,
      weekdays: normalizeWeekdays(recurrence.weekdays),
    };
  }
  throw new Error('Recurrence kind is invalid');
}

function cloneHabit(habit: Habit): Habit {
  return {
    ...habit,
    recurrence:
      habit.recurrence.kind === 'daily'
        ? { ...habit.recurrence }
        : { ...habit.recurrence, weekdays: [...habit.recurrence.weekdays] },
  };
}

function cloneCompletion(
  completion: HabitCompletionEvent,
): HabitCompletionEvent {
  return { ...completion };
}

function entityLookupKey(workspaceId: string, entityId: string): string {
  return JSON.stringify([workspaceId, entityId]);
}

function isScheduledOn(
  habit: Habit,
  date: ParsedLocalDate,
  start: ParsedLocalDate,
): boolean {
  const elapsedDays = date.epochDay - start.epochDay;
  if (elapsedDays < 0) {
    return false;
  }
  if (habit.recurrence.kind === 'daily') {
    return elapsedDays % habit.recurrence.interval === 0;
  }
  const startWeekEpochDay = start.epochDay - (start.isoWeekday - 1);
  const dateWeekEpochDay = date.epochDay - (date.isoWeekday - 1);
  const elapsedWeeks = (dateWeekEpochDay - startWeekEpochDay) / 7;
  return (
    elapsedWeeks % habit.recurrence.interval === 0 &&
    habit.recurrence.weekdays.includes(date.isoWeekday)
  );
}

export function generateHabitOccurrences(
  habit: Habit,
  fromLocalDate: string,
  toLocalDate: string,
): HabitOccurrence[] {
  const start = parseLocalDate(habit.startsOn);
  const from = parseLocalDate(fromLocalDate);
  const to = parseLocalDate(toLocalDate);
  const span = to.epochDay - from.epochDay;
  if (span < 0) {
    throw new Error('Occurrence range is reversed');
  }
  if (span + 1 > MAXIMUM_OCCURRENCE_RANGE_DAYS) {
    throw new Error('Occurrence range exceeds 366 days');
  }

  const occurrences: HabitOccurrence[] = [];
  for (let epochDay = from.epochDay; epochDay <= to.epochDay; epochDay += 1) {
    const date = localDateFromEpochDay(epochDay);
    if (isScheduledOn(habit, date, start)) {
      occurrences.push({
        habitId: habit.id,
        workspaceId: habit.workspaceId,
        scheduledLocalDate: date.text,
      });
    }
  }
  return occurrences;
}

export class InMemoryHabitRepository implements HabitRepository {
  private readonly habits = new Map<string, Habit>();
  private readonly completions = new Map<string, HabitCompletionEvent>();
  private readonly completionIdempotency = new Map<string, string>();

  async saveHabit(habit: Habit): Promise<void> {
    this.habits.set(
      entityLookupKey(habit.workspaceId, habit.id),
      cloneHabit(habit),
    );
  }

  async findHabit(
    workspaceId: string,
    habitId: string,
  ): Promise<Habit | undefined> {
    const habit = this.habits.get(entityLookupKey(workspaceId, habitId));
    return habit ? cloneHabit(habit) : undefined;
  }

  async listHabits(workspaceId: string): Promise<Habit[]> {
    return [...this.habits.values()]
      .filter((habit) => habit.workspaceId === workspaceId)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      )
      .map(cloneHabit);
  }

  async appendCompletion(
    completion: HabitCompletionEvent,
  ): Promise<HabitCompletionEvent> {
    const idempotencyLookup = JSON.stringify([
      completion.workspaceId,
      completion.habitId,
      completion.idempotencyKey,
    ]);
    const existingKey = this.completionIdempotency.get(idempotencyLookup);
    if (existingKey) {
      const existing = this.completions.get(existingKey);
      if (!existing) {
        throw new Error('Completion history is inconsistent');
      }
      if (
        existing.scheduledLocalDate !== completion.scheduledLocalDate ||
        existing.completedAt !== completion.completedAt
      ) {
        throw new Error(
          'Idempotency key reused with a different completion payload',
        );
      }
      return cloneCompletion(existing);
    }
    const stored = cloneCompletion(completion);
    const completionKey = entityLookupKey(stored.workspaceId, stored.id);
    this.completions.set(completionKey, stored);
    this.completionIdempotency.set(idempotencyLookup, completionKey);
    return cloneCompletion(stored);
  }

  async listCompletions(
    workspaceId: string,
    habitId: string,
  ): Promise<HabitCompletionEvent[]> {
    return [...this.completions.values()]
      .filter(
        (completion) =>
          completion.workspaceId === workspaceId &&
          completion.habitId === habitId,
      )
      .sort(
        (left, right) =>
          left.recordedAt.localeCompare(right.recordedAt) ||
          left.id.localeCompare(right.id),
      )
      .map(cloneCompletion);
  }
}

export class HabitService {
  constructor(private readonly repository: HabitRepository) {}

  async createHabit(
    workspaceId: string,
    input: {
      title: string;
      timezone: string;
      startsOn: string;
      recurrence: HabitRecurrence;
    },
  ): Promise<Habit> {
    const habit: Habit = {
      id: randomUUID(),
      workspaceId: requireOpaqueId(workspaceId),
      title: requireTitle(input.title),
      timezone: requireTimezone(input.timezone),
      startsOn: parseLocalDate(input.startsOn).text,
      recurrence: normalizeRecurrence(input.recurrence),
      createdAt: new Date().toISOString(),
    };
    await this.repository.saveHabit(habit);
    return cloneHabit(habit);
  }

  async listHabits(workspaceId: string): Promise<Habit[]> {
    return await this.repository.listHabits(requireOpaqueId(workspaceId));
  }

  /** Returns Habit-owned scheduled/completion evidence for one local date. */
  async listTodayHabits(
    workspaceId: string,
    localDate: string,
  ): Promise<HabitTodayStatus[]> {
    const safeWorkspaceId = requireOpaqueId(workspaceId);
    const safeLocalDate = parseLocalDate(localDate).text;
    const habits = await this.repository.listHabits(safeWorkspaceId);
    const today: HabitTodayStatus[] = [];

    for (const habit of habits) {
      if (
        generateHabitOccurrences(habit, safeLocalDate, safeLocalDate).length !==
        1
      ) {
        continue;
      }
      const completions = await this.repository.listCompletions(
        safeWorkspaceId,
        habit.id,
      );
      const completion = [...completions]
        .reverse()
        .find((event) => event.scheduledLocalDate === safeLocalDate);
      today.push(
        completion
          ? {
              habitId: habit.id,
              title: habit.title,
              scheduledLocalDate: safeLocalDate,
              completed: true,
              completionId: completion.id,
            }
          : {
              habitId: habit.id,
              title: habit.title,
              scheduledLocalDate: safeLocalDate,
              completed: false,
            },
      );
    }
    return today;
  }

  async listOccurrences(
    workspaceId: string,
    habitId: string,
    fromLocalDate: string,
    toLocalDate: string,
  ): Promise<HabitOccurrence[]> {
    const safeWorkspaceId = requireOpaqueId(workspaceId);
    const safeHabitId = requireOpaqueId(habitId);
    const habit = await this.repository.findHabit(safeWorkspaceId, safeHabitId);
    if (!habit) {
      throw new Error('Habit not found');
    }
    return generateHabitOccurrences(habit, fromLocalDate, toLocalDate);
  }

  async completeHabit(
    workspaceId: string,
    habitId: string,
    input: {
      scheduledLocalDate: string;
      completedAt: string;
      idempotencyKey: string;
    },
  ): Promise<HabitCompletionEvent> {
    const safeWorkspaceId = requireOpaqueId(workspaceId);
    const safeHabitId = requireOpaqueId(habitId);
    const habit = await this.repository.findHabit(safeWorkspaceId, safeHabitId);
    if (!habit) {
      throw new Error('Habit not found');
    }
    const scheduledLocalDate = parseLocalDate(input.scheduledLocalDate).text;
    if (
      generateHabitOccurrences(habit, scheduledLocalDate, scheduledLocalDate)
        .length !== 1
    ) {
      throw new Error('Habit is not scheduled on this date');
    }
    const now = new Date().toISOString();
    return await this.repository.appendCompletion({
      id: randomUUID(),
      workspaceId: safeWorkspaceId,
      habitId: safeHabitId,
      scheduledLocalDate,
      completedAt: requireTimestamp(input.completedAt),
      idempotencyKey: requireUuidV4(input.idempotencyKey),
      recordedAt: now,
    });
  }

  async listCompletionHistory(
    workspaceId: string,
    habitId: string,
  ): Promise<HabitCompletionEvent[]> {
    const safeWorkspaceId = requireOpaqueId(workspaceId);
    const safeHabitId = requireOpaqueId(habitId);
    if (!(await this.repository.findHabit(safeWorkspaceId, safeHabitId))) {
      throw new Error('Habit not found');
    }
    return await this.repository.listCompletions(safeWorkspaceId, safeHabitId);
  }
}
