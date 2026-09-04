import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Headers,
  Inject,
  Optional,
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
export const NOTIFICATION_DATA_RIGHTS_CONTEXT_SECRET = Symbol(
  'NOTIFICATION_DATA_RIGHTS_CONTEXT_SECRET',
);

/** Server-observed request properties used to bind service authority to the exact route. */
export interface NotificationDataRightsHttpRequestIdentity {
  readonly method?: unknown;
  readonly originalUrl?: unknown;
}

/** Derives the credential-free durable claim key from one already-verified HMAC signature. */
function authorityClaimDigest(signature: string): string {
  return createHash('sha256').update(signature, 'ascii').digest('hex');
}

/** Private authenticated HTTP controller for Notification-owned data-rights operations. */
@Controller('internal/data-rights')
export class NotificationDataRightsController {
  private readonly contextSecret: string | undefined;

  /**
   * Receives the already-composed Notification runtime and authentication secret
   * without creating foreign persistence or rereading ambient process state.
   * Nest compositions may omit the optional secret provider and retain the
   * process-environment fallback; explicit composition roots pass their already-
   * validated secret so startup validation and request authentication cannot drift.
   */
  constructor(
    @Inject(NOTIFICATION_DATA_RIGHTS_RUNTIME)
    private readonly runtime: NotificationRuntime,
    @Optional()
    @Inject(NOTIFICATION_DATA_RIGHTS_CONTEXT_SECRET)
    contextSecret?: string,
  ) {
    this.contextSecret =
      contextSecret ?? process.env.NOTIFICATION_DATA_RIGHTS_CONTEXT_SECRET;
  }

  /**
   * Verifies Identity-issued authority before forwarding one normalized request
   * to the Notification-owned contributor. No caller-supplied tenant or actor
   * reaches persistence unless it is covered by the exact short-lived HMAC;
   * destructive authority must also win the durable one-time replay guard.
   * A failed erasure releases only its credential-free claim so the same still-
   * valid authorized request may safely retry the contributor's idempotent erase.
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
      this.contextSecret,
      { method: request.method, path: request.originalUrl },
      Math.floor(Date.now() / 1000),
      this.runtime.dataRightsAuthorityReplayGuard,
    );
    try {
      return await this.runtime.dataRightsContributor.handle(trusted);
    } catch (error) {
      if (trusted.operation === 'erase' && typeof signature === 'string') {
        try {
          await this.runtime.dataRightsAuthorityReplayGuard.release(
            authorityClaimDigest(signature),
          );
        } catch {
          // Fail closed: retaining a claim is safer than admitting a duplicate erase.
        }
      }
      throw toNotificationDataRightsHttpException(error);
    }
  }
}
