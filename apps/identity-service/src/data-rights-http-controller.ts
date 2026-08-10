import {
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Res,
} from '@nestjs/common';
import { problemDetails } from './oauth-http-boundary';
import { DataRightsRequestValidationError } from './data-rights-request-ledger';
import {
  AuthenticatedDataRightsStatusApplication,
  DataRightsRequestNotFoundError,
} from './data-rights-status-application';

export { DataRightsRequestNotFoundError } from './data-rights-status-application';

export const DATA_RIGHTS_STATUS_APPLICATION = Symbol(
  'DATA_RIGHTS_STATUS_APPLICATION',
);

interface MutableHttpResponse {
  status(statusCode: number): MutableHttpResponse;
  setHeader(name: string, value: string): void;
  type(contentType: string): MutableHttpResponse;
  send(body?: unknown): MutableHttpResponse;
}

interface ProblemMapping {
  readonly status: number;
  readonly title: string;
  readonly code: string;
}

function mapStatusError(error: unknown): ProblemMapping {
  if (error instanceof DataRightsRequestValidationError) {
    return {
      status: 400,
      title: 'Invalid data-rights request',
      code: 'invalid_data_rights_request',
    };
  }
  if (
    error instanceof Error &&
    error.message === 'Session is invalid or expired'
  ) {
    return {
      status: 401,
      title: 'Authentication is required',
      code: 'authentication_required',
    };
  }
  if (error instanceof DataRightsRequestNotFoundError) {
    return {
      status: 404,
      title: 'Data-rights request was not found',
      code: 'data_rights_request_not_found',
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

/** Browser-facing authenticated data-rights request-status resource. */
@Controller()
export class DataRightsHttpController {
  constructor(
    @Inject(DATA_RIGHTS_STATUS_APPLICATION)
    private readonly application: AuthenticatedDataRightsStatusApplication,
  ) {}

  /** Returns one bounded request lifecycle without exposing tenant or receipt internals. */
  @Get('v1/data-rights/requests/:requestId')
  async getRequestStatus(
    @Param('requestId') requestId: string,
    @Headers('cookie') cookieHeader: string | undefined,
    @Res() response: MutableHttpResponse,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const result = await this.application.getRequestStatus(
        cookieHeader,
        requestId,
      );
      response.status(200);
      response.type('application/json');
      response.send(result);
    } catch (error) {
      sendProblem(response, mapStatusError(error));
    }
  }
}
