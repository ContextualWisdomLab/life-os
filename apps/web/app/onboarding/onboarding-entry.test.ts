import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEmptyTodayDraft,
  addTodayAction,
} from '../today-state';
import { serializeTodayDraft } from '../today-storage';
import {
  ONBOARDING_COMPLETION_STORAGE_KEY,
  ONBOARDING_DISMISSAL_STORAGE_KEY,
  serializeOnboardingDismissal,
  shouldEnterOnboarding,
} from './onboarding-entry';

const DATE = '2026-08-04';
const RECORDED_AT = '2026-08-04T00:00:00.000Z';

function completionMarker(): string {
  return JSON.stringify({
    version: ONBOARDING_COMPLETION_STORAGE_KEY,
    completedAt: RECORDED_AT,
  });
}

test('enters onboarding only for a genuinely empty trusted browser state', () => {
  assert.equal(
    shouldEnterOnboarding({
      todaySerialized: null,
      completionSerialized: null,
      dismissalSerialized: null,
      date: DATE,
    }),
    true,
  );
  assert.equal(
    shouldEnterOnboarding({
      todaySerialized: serializeTodayDraft(createEmptyTodayDraft(DATE)),
      completionSerialized: null,
      dismissalSerialized: null,
      date: DATE,
    }),
    true,
  );
});

test('preserves existing Today work and malformed raw storage', () => {
  const existing = addTodayAction(createEmptyTodayDraft(DATE), {
    id: '3b237d04-e84c-4ac4-933d-7f179865e1a0',
    title: 'Protect the existing plan',
    createdAt: RECORDED_AT,
  });
  assert.equal(
    shouldEnterOnboarding({
      todaySerialized: serializeTodayDraft(existing),
      completionSerialized: null,
      dismissalSerialized: null,
      date: DATE,
    }),
    false,
  );
  assert.equal(
    shouldEnterOnboarding({
      todaySerialized: '{"unexpected":true}',
      completionSerialized: null,
      dismissalSerialized: null,
      date: DATE,
    }),
    false,
  );
  assert.equal(
    shouldEnterOnboarding({
      todaySerialized: 'x'.repeat(140_000),
      completionSerialized: null,
      dismissalSerialized: null,
      date: DATE,
    }),
    false,
  );
});

test('honors exact completion and intentional dismissal markers', () => {
  assert.equal(
    shouldEnterOnboarding({
      todaySerialized: null,
      completionSerialized: completionMarker(),
      dismissalSerialized: null,
      date: DATE,
    }),
    false,
  );
  const dismissal = serializeOnboardingDismissal(RECORDED_AT);
  assert.deepEqual(JSON.parse(dismissal), {
    version: ONBOARDING_DISMISSAL_STORAGE_KEY,
    dismissedAt: RECORDED_AT,
  });
  assert.equal(
    shouldEnterOnboarding({
      todaySerialized: null,
      completionSerialized: null,
      dismissalSerialized: dismissal,
      date: DATE,
    }),
    false,
  );
});

test('ignores malformed, oversized, and unknown marker shapes', () => {
  assert.equal(
    shouldEnterOnboarding({
      todaySerialized: null,
      completionSerialized: JSON.stringify({
        version: ONBOARDING_COMPLETION_STORAGE_KEY,
        completedAt: RECORDED_AT,
        workspaceId: '474c83ae-08af-4a63-957b-49eb2093a61d',
      }),
      dismissalSerialized: null,
      date: DATE,
    }),
    true,
  );
  assert.equal(
    shouldEnterOnboarding({
      todaySerialized: null,
      completionSerialized: null,
      dismissalSerialized: 'x'.repeat(5_000),
      date: DATE,
    }),
    true,
  );
  assert.throws(() => serializeOnboardingDismissal('not-a-date'));
});
