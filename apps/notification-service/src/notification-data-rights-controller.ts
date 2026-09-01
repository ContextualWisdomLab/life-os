import {
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import type { NotificationDataRightsResponse } from './notification-data-rights';
import {
  parseTrustedNotificationDataRightsRequest,
  toNotificationDataRightsHttpException,
} from './notification-data-rights-http-boundary';
import type { NotificationRuntime } from './notification-runtime';

export const NOTIFICATION_DATA_RIGHTS_RUNTIME = Symbol(
  'NOTIFICATION_DATA_RIGHTS_RUNTIME',
);

/** Server-observed request properties used to bind service authority to the exact route. */
export interface NotificationDataRightsHttpRequestIdentity {
  readonly method?: unknown;
  readonly originalUrl?: unknown;
}

/** Private authenticated HTTP controller for Notification-owned data-rights operations. */
@Controller('internal/data-rights')
export class NotificationDataRightsController {
  /** Receives the already-composed Notification runtime without creating foreign persistence. */
  constructor(
    @Inject(NOTIFICATION_DATA_RIGHTS_RUNTIME)
    private readonly runtime: NotificationRuntime,
  ) {}

  /**
   * Verifies Identity-issued authority before forwarding one normalized request
   * to the Notification-owned contributor. No caller-supplied tenant or actor
   * reaches persistence unless it is covered by the exact short-lived HMAC.
   */
  @Post('contributor')
  async contribute(
    @Headers('x-life-os-data-rights-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-data-rights-signature') signature: string | undefined,
    @Req() request: NotificationDataRightsHttpRequestIdentity,
    @Body() body: unknown,
  ): Promise<NotificationDataRightsResponse> {
    const trusted = await parseTrustedNotificationDataRightsRequest(
      body,
      { issuedAt, signature },
      process.env.NOTIFICATION_DATA_RIGHTS_CONTEXT_SECRET,
      { method: request.method, path: request.originalUrl },
      Math.floor(Date.now() / 1000),
    );
    try {
      return await this.runtime.dataRightsContributor.handle(trusted);
    } catch (error) {
      throw toNotificationDataRightsHttpException(error);
    }
  }
}
