import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';

const applications: INestApplication[] = [];

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

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

describe('Gateway Today HTTP boundary', () => {
  it('returns explicit non-cacheable unavailable evidence instead of fake Today data', async () => {
    const { baseUrl } = await createHarness();

    const response = await fetch(`${baseUrl}/v1/today`);
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
