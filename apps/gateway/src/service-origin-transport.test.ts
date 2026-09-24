import { describe, expect, it } from 'vitest';
import { composePlanningToday, GatewayTodayError } from './today-composition';

const SECRET = 'a'.repeat(32);

describe('Gateway service-origin transport', () => {
  it('rejects remote cleartext before sending credentials upstream', async () => {
    let calls = 0;
    await expect(
      composePlanningToday(
        'session=opaque',
        '2026-09-24',
        {
          IDENTITY_SERVICE_ORIGIN: 'http://identity.example.test',
          PLANNING_SERVICE_ORIGIN: 'https://planning.example.test',
          PLANNING_GATEWAY_CONTEXT_SECRET: SECRET,
        },
        async () => {
          calls += 1;
          throw new Error('fetch must not run');
        },
      ),
    ).rejects.toMatchObject({
      status: 503,
      code: 'today_composition_unavailable',
    } satisfies Partial<GatewayTodayError>);
    expect(calls).toBe(0);
  });
});
