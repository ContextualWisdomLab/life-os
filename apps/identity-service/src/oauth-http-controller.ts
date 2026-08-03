import { Controller, Get, Headers, Inject, Post, Res } from '@nestjs/common';
import type { IdentityProvider } from './identity-domain';
import { problemDetails } from './oauth-http-boundary';
import { OAuthHttpApplication } from './oauth-http-application';

export const OAUTH_HTTP_APPLICATION = Symbol('OAUTH_HTTP_APPLICATION');

interface MutableHttpResponse {
  status(statusCode: number): MutableHttpResponse;
  setHeader(name: string, value: string): void;
  type(contentType: string): MutableHttpResponse;
  send(body?: unknown): MutableHttpResponse;
}

interface ProblemMapping {
  status: number;
  title: string;
  code: string;
}

const INVALID_REQUEST_MESSAGES = new Set([
  'Cookie header is invalid',
  'Cookie name is invalid',
  'OAuth provider is not supported',
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

function mapStartError(error: unknown): ProblemMapping {
  if (INVALID_REQUEST_MESSAGES.has(errorMessage(error))) {
    return {
      status: 400,
      title: 'Invalid authorization request',
      code: 'invalid_authorization_request',
    };
  }
  return {
    status: 503,
    title: 'Identity service is unavailable',
    code: 'identity_service_unavailable',
  };
}

function mapSessionError(error: unknown): ProblemMapping {
  if (errorMessage(error) === 'Session is invalid or expired') {
    return {
      status: 401,
      title: 'Authentication is required',
      code: 'authentication_required',
    };
  }
  if (INVALID_REQUEST_MESSAGES.has(errorMessage(error))) {
    return {
      status: 400,
      title: 'Invalid session request',
      code: 'invalid_session_request',
    };
  }
  return {
    status: 503,
    title: 'Identity service is unavailable',
    code: 'identity_service_unavailable',
  };
}

function sendProblem(
  response: MutableHttpResponse,
  mapping: ProblemMapping,
): void {
  response.status(mapping.status);
  response.type('application/problem+json');
  response.send(problemDetails(mapping.status, mapping.title, mapping.code));
}

@Controller()
export class OAuthHttpController {
  constructor(
    @Inject(OAUTH_HTTP_APPLICATION)
    private readonly application: OAuthHttpApplication,
  ) {}

  @Get('v1/auth/google/start')
  async startGoogle(
    @Headers('cookie') cookieHeader: string | undefined,
    @Res() response: MutableHttpResponse,
  ): Promise<void> {
    await this.startAuthorization('google', cookieHeader, response);
  }

  @Get('v1/auth/github/start')
  async startGitHub(
    @Headers('cookie') cookieHeader: string | undefined,
    @Res() response: MutableHttpResponse,
  ): Promise<void> {
    await this.startAuthorization('github', cookieHeader, response);
  }

  @Get('v1/session')
  async session(
    @Headers('cookie') cookieHeader: string | undefined,
    @Res() response: MutableHttpResponse,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const result = await this.application.introspectSession(cookieHeader);
      response.status(result.statusCode);
      response.type('application/json');
      response.send(result.body);
    } catch (error) {
      sendProblem(response, mapSessionError(error));
    }
  }

  @Post('v1/auth/logout')
  async logout(
    @Headers('cookie') cookieHeader: string | undefined,
    @Res() response: MutableHttpResponse,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const result = await this.application.logout(cookieHeader);
      response.setHeader('Set-Cookie', result.setCookie);
      response.status(result.statusCode);
      response.send();
    } catch (error) {
      sendProblem(response, mapSessionError(error));
    }
  }

  private async startAuthorization(
    provider: IdentityProvider,
    cookieHeader: string | undefined,
    response: MutableHttpResponse,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const result = await this.application.beginAuthorization(
        provider,
        cookieHeader,
      );
      if (result.setCookie) {
        response.setHeader('Set-Cookie', result.setCookie);
      }
      response.setHeader('Location', result.location);
      response.status(result.statusCode);
      response.send();
    } catch (error) {
      sendProblem(response, mapStartError(error));
    }
  }
}
