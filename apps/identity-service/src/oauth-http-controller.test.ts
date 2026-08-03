import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { OAuthCallbackApplication } from './oauth-callback-application';
import { OAuthHttpApplication } from './oauth-http-application';
import { OAuthHttpController } from './oauth-http-controller';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  return overrides as unknown as OAuthHttpApplication;
}

function callbackApplication(
  overrides: Partial<OAuthCallbackApplication> = {},
): OAuthCallbackApplication {
  return overrides as unknown as OAuthCallbackApplication;
}

function controller(
  httpOverrides: Partial<OAuthHttpApplication>,
  callbackOverrides: Partial<OAuthCallbackApplication> = {},
): OAuthHttpController {
  return new OAuthHttpController(
    application(httpOverrides),
    callbackApplication(callbackOverrides),
  );
}

describe('OAuthHttpController', () => {
  it('publishes fixed authorization, callback, session, and logout routes', () => {
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
      Reflect.getMetadata(
        PATH_METADATA,
        OAuthHttpController.prototype.callbackGoogle,
      ),
    ).toBe('v1/auth/google/callback');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        OAuthHttpController.prototype.callbackGitHub,
      ),
    ).toBe('v1/auth/github/callback');
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
    const instance = controller({ beginAuthorization });
    const response = new TestResponse();

    await instance.startGoogle(undefined, response);

    expect(beginAuthorization).toHaveBeenCalledWith('google', undefined);
    expect(response.statusCode).toBe(303);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('location')).toContain(
      'https://accounts.google.com/',
    );
    expect(response.headers.get('set-cookie')).toContain('Secure');
    expect(response.body).toBeUndefined();
  });

  it('completes callbacks with the exact provider, query, browser cookie, and valid correlation ID', async () => {
    const completeAuthorization = vi.fn().mockResolvedValue({
      statusCode: 303,
      location: 'https://app.example.test/auth/complete',
      setCookie:
        'life_os_session=opaque; Path=/; HttpOnly; Secure; SameSite=Lax',
    });
    const instance = controller({}, { completeAuthorization });
    const response = new TestResponse();
    const query = { code: 'authorization-code', state: 'opaque-state' };

    await instance.callbackGitHub(
      query,
      'life_os_oauth_browser=browser-binding',
      'correlation-value',
      response,
    );

    expect(completeAuthorization).toHaveBeenCalledWith(
      'github',
      query,
      'life_os_oauth_browser=browser-binding',
      'correlation-value',
    );
    expect(response.statusCode).toBe(303);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-correlation-id')).toBe('correlation-value');
    expect(response.headers.get('location')).toBe(
      'https://app.example.test/auth/complete',
    );
    expect(response.headers.get('set-cookie')).toContain(
      'HttpOnly; Secure; SameSite=Lax',
    );
    expect(response.body).toBeUndefined();
  });

  it.each([undefined, 'bad\ncorrelation']) (
    'generates and returns a bounded correlation ID when the request header is %s',
    async (correlationIdHeader) => {
      const completeAuthorization = vi.fn().mockResolvedValue({
        statusCode: 303,
        location: 'https://app.example.test/auth/complete',
        setCookie: 'life_os_session=opaque; Secure; HttpOnly',
      });
      const instance = controller({}, { completeAuthorization });
      const response = new TestResponse();

      await instance.callbackGoogle(
        { code: 'authorization-code', state: 'opaque-state' },
        'life_os_oauth_browser=browser-binding',
        correlationIdHeader,
        response,
      );

      const generatedCorrelationId = response.headers.get('x-correlation-id');
      expect(generatedCorrelationId).toMatch(UUID_V4_PATTERN);
      expect(completeAuthorization).toHaveBeenCalledWith(
        'google',
        expect.any(Object),
        'life_os_oauth_browser=browser-binding',
        generatedCorrelationId,
      );
    },
  );

  it('maps callback authentication failures to one credential-free problem response', async () => {
    const completeAuthorization = vi
      .fn()
      .mockRejectedValue(new Error('OAuth callback authentication failed'));
    const instance = controller({}, { completeAuthorization });
    const response = new TestResponse();

    await instance.callbackGoogle(
      { error: 'access_denied', state: 'opaque-state' },
      undefined,
      undefined,
      response,
    );

    expect(response.statusCode).toBe(400);
    expect(response.contentType).toBe('application/problem+json');
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Authorization could not be completed',
      status: 400,
      code: 'oauth_callback_failed',
    });
    expect(JSON.stringify(response.body)).not.toContain('opaque-state');
  });

  it('redacts unexpected callback diagnostics behind service unavailability', async () => {
    const completeAuthorization = vi
      .fn()
      .mockRejectedValue(new Error('provider-token-and-upstream-diagnostic'));
    const instance = controller({}, { completeAuthorization });
    const response = new TestResponse();

    await instance.callbackGitHub(
      { code: 'authorization-code', state: 'opaque-state' },
      undefined,
      'correlation-value',
      response,
    );

    expect(response.statusCode).toBe(503);
    expect(response.contentType).toBe('application/problem+json');
    expect(JSON.stringify(response.body)).not.toContain('provider-token');
    expect(JSON.stringify(response.body)).not.toContain('opaque-state');
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
    const instance = controller({ introspectSession, logout });
    const sessionResponse = new TestResponse();
    const logoutResponse = new TestResponse();

    await instance.session('life_os_session=opaque', sessionResponse);
    await instance.logout('life_os_session=opaque', logoutResponse);

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
    const instance = controller({ beginAuthorization, introspectSession });
    const startResponse = new TestResponse();
    const sessionResponse = new TestResponse();

    await instance.startGitHub(undefined, startResponse);
    await instance.session(undefined, sessionResponse);

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
