import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';

const applications: INestApplication[] = [];
const TODAY_DEPENDENCY_KEYS = [
  'IDENTITY_SERVICE_ORIGIN',
  'PLANNING_SERVICE_ORIGIN',
  'PLANNING_GATEWAY_CONTEXT_SECRET',
] as const;
let previousTodayDependencies: ReadonlyArray<
  readonly [(typeof TODAY_DEPENDENCY_KEYS)[number], string | undefined]
> = [];

async function createHarness(): Promise<{
  app: INestApplication;
  baseUrl: string;
}> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('v1');
  await app.listen(0, '127.0.0.1');
  applications.push(app);
  const address = app.getHttpServer().address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

beforeEach(() => {
  previousTodayDependencies = TODAY_DEPENDENCY_KEYS.map(
    (key) => [key, process.env[key]] as const,
  );
  for (const key of TODAY_DEPENDENCY_KEYS) delete process.env[key];
});

afterEach(async () => {
  try {
    await Promise.all(applications.splice(0).map((app) => app.close()));
  } finally {
    for (const [key, value] of previousTodayDependencies) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previousTodayDependencies = [];
  }
});

describe('Gateway Today HTTP boundary', () => {
  it('returns a bounded invalid-request problem when the required date is absent', async () => {
    const { baseUrl } = await createHarness();

    const response = await fetch(`${baseUrl}/v1/today`);
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      type: 'about:blank',
      title: 'Today composition request is invalid',
      status: 400,
      code: 'invalid_today_request',
    });
  });

  it('returns explicit non-cacheable unavailable evidence when trusted dependencies are not configured', async () => {
    const { baseUrl } = await createHarness();

    const response = await fetch(`${baseUrl}/v1/today?date=2026-08-10`);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toEqual({
      type: 'about:blank',
      title: 'Today composition is unavailable',
      status: 503,
      code: 'today_composition_unavailable',
    });
    expect(JSON.stringify(body)).not.toMatch(/placeholder|Ship one|Morning routine/u);
  });
});
