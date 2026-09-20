/** Canonical bounded exponential retry policy shared by application and persistence adapters. */
export const PLUGIN_DELIVERY_ATTEMPT_RETRY_BACKOFF_POLICY = Object.freeze({
  firstAttempt: 1,
  initialSeconds: 30,
  maximumSeconds: 900,
});

/** Returns the bounded retry delay for a validated one-based delivery attempt number. */
export function pluginDeliveryAttemptRetryBackoffSeconds(
  attemptNumber: number,
): number {
  const exponent = Math.max(
    0,
    attemptNumber - PLUGIN_DELIVERY_ATTEMPT_RETRY_BACKOFF_POLICY.firstAttempt,
  );
  return Math.min(
    PLUGIN_DELIVERY_ATTEMPT_RETRY_BACKOFF_POLICY.initialSeconds * 2 ** exponent,
    PLUGIN_DELIVERY_ATTEMPT_RETRY_BACKOFF_POLICY.maximumSeconds,
  );
}

/** PostgreSQL retry-delay expression derived from the same canonical constants as TypeScript. */
export const PLUGIN_DELIVERY_ATTEMPT_RETRY_BACKOFF_SQL = `LEAST(${PLUGIN_DELIVERY_ATTEMPT_RETRY_BACKOFF_POLICY.maximumSeconds}, ${PLUGIN_DELIVERY_ATTEMPT_RETRY_BACKOFF_POLICY.initialSeconds} * power(2, GREATEST(attempt_count - ${PLUGIN_DELIVERY_ATTEMPT_RETRY_BACKOFF_POLICY.firstAttempt}, 0)))`;
