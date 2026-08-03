import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { OAuthHttpApplication } from './oauth-http-application';
import { OAuthHttpController } from './oauth-http-controller';

class TestResponse {
  statusCode = 0;
  contentType = '';
  readonly headers = new Map<string, string>();
  body: unknown;

  status(statusCode: number): TestResponse {
    this.statusCode = statusCode;
    return this;
  }

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  type(contentType: string): TestResponse {
    this.contentType = contentType;
    return this;
  }

  send(body?: unknown): TestResponse {
    this.body = body;
    return this;
  }
}

function application(
  overrides: Partial<OAuthHttpApplication>,
): OAuthHttpApplication {
  return overrides as OAuthHttpApplication;
}

describe('OAuthHttpController', () => {
  it('publishes the fixed authorization, session, and logout routes', () => {
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        OAuthHttpController.prototype.startGoogle,
      ),
    ).toBe('v1/auth/google/start');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        OAuthHttpController.prototype.startGitHub,
      ),
    ).toBe('v1/auth/github/start');
    expect(
      Reflect.getMetadata(PATH_METADATA, OAuthHttpController.prototype.session),
    ).toBe('v1/session');
    expect(
      Reflect.getMetadata(PATH_METADATA, OAuthHttpController.prototype.logout),
    ).toBe('v1/auth/logout');
  });

  it('starts Google authorization with a no-store redirect and secure cookie', async () => {
    const beginAuthorization = vi.fn().mockResolvedValue({
      statusCode: 303,
      location: 'https://accounts.google.com/o/oauth2/v2/auth?state=opaque',
      setCookie: 'life_os_oauth_browser=opaque; Secure; HttpOnly',
    });
    const controller = new OAuthHttpController(
      application({ beginAuthorization }),
    );
    const response = new TestResponse();

    await controller.startGoogle(undefined, response);

    expect(beginAuthorization).toHaveBeenCalledWith('google', undefined);
    expect(response.statusCode).toBe(303);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('location')).toContain(
      'https://accounts.google.com/',
    );
    expect(response.headers.get('set-cookie')).toContain('Secure');
    expect(response.body).toBeUndefined();
  });

  it('returns token-free session JSON and an idempotent logout response', async () => {
    const introspectSession = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: {
        sessionId: 'a4e1055f-3ff1-4501-8d4e-ab98915de4bf',
        userId: '4c2e89dd-c566-49d3-a1bf-5778db353e73',
        workspaceId: '1a97f0d7-58af-4593-85da-130d9179ae83',
        createdAt: '2026-08-03T10:00:00.000Z',
        expiresAt: '2026-09-02T10:00:00.000Z',
      },
    });
    const logout = vi.fn().mockResolvedValue({
      statusCode: 204,
      setCookie:
        'life_os_session=deleted; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    });
    const controller = new OAuthHttpController(
      application({ introspectSession, logout }),
    );
    const sessionResponse = new TestResponse();
    const logoutResponse = new TestResponse();

    await controller.session('life_os_session=opaque', sessionResponse);
    await controller.logout('life_os_session=opaque', logoutResponse);

    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.contentType).toBe('application/json');
    expect(JSON.stringify(sessionResponse.body)).not.toContain('opaque');
    expect(logoutResponse.statusCode).toBe(204);
    expect(logoutResponse.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('maps credential-bearing internal errors to stable problem bodies', async () => {
    const beginAuthorization = vi
      .fn()
      .mockRejectedValue(new Error('database password=secret-token'));
    const introspectSession = vi
      .fn()
      .mockRejectedValue(new Error('Session is invalid or expired'));
    const controller = new OAuthHttpController(
      application({ beginAuthorization, introspectSession }),
    );
    const startResponse = new TestResponse();
    const sessionResponse = new TestResponse();

    await controller.startGitHub(undefined, startResponse);
    await controller.session(undefined, sessionResponse);

    expect(startResponse.statusCode).toBe(503);
    expect(startResponse.contentType).toBe('application/problem+json');
    expect(JSON.stringify(startResponse.body)).not.toContain('secret-token');
    expect(sessionResponse.statusCode).toBe(401);
    expect(sessionResponse.body).toEqual({
      type: 'about:blank',
      title: 'Authentication is required',
      status: 401,
      code: 'authentication_required',
    });
  });
});
