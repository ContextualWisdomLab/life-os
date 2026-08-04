import { describe, expect, it } from 'vitest';
import * as publicApi from './main';

/** Verifies that every runtime entry point remains available from the package. */
describe('notification-service public API', () => {
  it('exports the scheduler, PostgreSQL adapters, and runtime factories', () => {
    expect(publicApi).toMatchObject({
      ReminderScheduler: expect.any(Function),
      ReminderValidationError: expect.any(Function),
      validateReminderOccurrence: expect.any(Function),
      isWithinQuietHours: expect.any(Function),
      PostgresReminderRepository: expect.any(Function),
      PostgresInAppDeliveryGateway: expect.any(Function),
      NotificationPersistenceError: expect.any(Function),
      NotificationReplayConflictError: expect.any(Function),
      hashNotificationIdempotencyKey: expect.any(Function),
      NotificationRuntime: expect.any(Function),
      createNotificationPoolConfiguration: expect.any(Function),
      createNotificationRuntime: expect.any(Function),
    });
    expect(publicApi.MAX_REMINDER_BATCH_SIZE).toBe(100);
    expect(publicApi.MAX_REMINDER_TITLE_LENGTH).toBe(160);
    expect(publicApi.MAX_DAILY_REMINDERS).toBe(20);
    expect(publicApi.MAX_DELIVERY_ATTEMPTS).toBe(3);
  });
});
