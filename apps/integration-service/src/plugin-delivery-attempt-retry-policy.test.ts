import { describe, expect, it } from 'vitest';
import {
  PLUGIN_DELIVERY_ATTEMPT_RETRY_BACKOFF_POLICY,
  PLUGIN_DELIVERY_ATTEMPT_RETRY_BACKOFF_SQL,
  pluginDeliveryAttemptRetryBackoffSeconds,
} from './plugin-delivery-attempt-retry-policy';

describe('Plugin delivery attempt retry backoff policy', () => {
  it('keeps TypeScript retry timing on the canonical bounded exponential policy', () => {
    expect(PLUGIN_DELIVERY_ATTEMPT_RETRY_BACKOFF_POLICY).toEqual({
      firstAttempt: 1,
      initialSeconds: 30,
      maximumSeconds: 900,
    });
    expect(pluginDeliveryAttemptRetryBackoffSeconds(1)).toBe(30);
    expect(pluginDeliveryAttemptRetryBackoffSeconds(2)).toBe(60);
    expect(pluginDeliveryAttemptRetryBackoffSeconds(5)).toBe(480);
    expect(pluginDeliveryAttemptRetryBackoffSeconds(6)).toBe(900);
    expect(pluginDeliveryAttemptRetryBackoffSeconds(10)).toBe(900);
  });

  it('derives the PostgreSQL expression from the same canonical policy', () => {
    expect(PLUGIN_DELIVERY_ATTEMPT_RETRY_BACKOFF_SQL).toBe(
      'LEAST(900, 30 * power(2, GREATEST(attempt_count - 1, 0)))',
    );
  });
});
