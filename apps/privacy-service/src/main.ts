import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Module,
  Post,
} from '@nestjs/common';
import type {
  PrivacyAccessConsumeCommand,
  PrivacyAccessDecisionCommand,
  PrivacyAccessDecisionResult,
} from './privacy-access-application';
import {
  deniedPrivacyDecisionException,
  extractPrivacyServiceContextHeaders,
  parsePrivacyAccessConsumeBody,
  parsePrivacyAccessDecisionBody,
  toPrivacyHttpException,
} from './privacy-http-boundary';
import type { PrivacyGrantConsumptionReceipt } from './privacy-access-repository';
import {
  createPrivacyRuntime,
  PrivacyRuntime,
  type PrivacyRuntimeEnvironment,
} from './privacy-runtime';
import {
  verifyPrivacyServiceContext,
  type PrivacyServiceContextKeyRing,
} from './privacy-service-context';

/** Dependency-injection token for the owned production runtime. */
export const PRIVACY_RUNTIME = Symbol('PRIVACY_RUNTIME');
/** Dependency-injection token for the purpose-bound access application. */
export const PRIVACY_ACCESS_APPLICATION = Symbol('PRIVACY_ACCESS_APPLICATION');
/** Dependency-injection token for the private service-context key ring. */
export const PRIVACY_CONTEXT_KEY_RING = Symbol('PRIVACY_CONTEXT_KEY_RING');
/** Dependency-injection token for the request-validation clock. */
export const PRIVACY_CLOCK = Symbol('PRIVACY_CLOCK');

/** Narrow operations consumed by the HTTP controller. */
export interface PrivacyAccessOperations {
  /** Evaluates and persists one purpose-bound decision. */
  decide(
    command: PrivacyAccessDecisionCommand,
  ): Promise<PrivacyAccessDecisionResult>;
  /** Consumes one exact single-use grant. */
  consume(
    command: PrivacyAccessConsumeCommand,
  ): Promise<PrivacyGrantConsumptionReceipt>;
}

/** Creates one validated runtime for Nest dependency injection. */
export function createPrivacyRuntimeProvider(
  environment: PrivacyRuntimeEnvironment = process.env,
): PrivacyRuntime {
  return createPrivacyRuntime(environment);
}

/** Projects the purpose-bound application from one owned runtime. */
export function privacyApplicationFromRuntime(
  runtime: PrivacyRuntime,
): PrivacyAccessOperations {
  return runtime.application;
}

/** Projects the private service-context key ring from one owned runtime. */
export function privacyContextKeyRingFromRuntime(
  runtime: PrivacyRuntime,
): PrivacyServiceContextKeyRing {
  return runtime.contextKeyRing;
}

/** Creates one request-validation clock without shared mutable state. */
export function createPrivacyClock(): () => Date {
  return () => new Date();
}

/** Purpose-bound privacy authorization and evidence HTTP boundary. */
@Controller('privacy')
export class PrivacyController {
  /** Creates one controller over explicit application, keys, and clock seams. */
  constructor(
    @Inject(PRIVACY_ACCESS_APPLICATION)
    private readonly application: PrivacyAccessOperations,
    @Inject(PRIVACY_CONTEXT_KEY_RING)
    private readonly contextKeyRing: PrivacyServiceContextKeyRing,
    @Inject(PRIVACY_CLOCK)
    private readonly clock: () => Date,
  ) {}

  /** Returns a bounded liveness response without loading tenant data. */
  @Get('health')
  health(): { readonly status: 'ok'; readonly service: 'privacy-service' } {
    return { status: 'ok', service: 'privacy-service' };
  }

  /** Evaluates one trusted actor/workspace request without accepting ownership in JSON. */
  @Post('access-decisions')
  async decide(
    @Headers() headers: Readonly<Record<string, unknown>>,
    @Body() body: unknown,
  ): Promise<PrivacyAccessDecisionResult> {
    try {
      const context = verifyPrivacyServiceContext(
        extractPrivacyServiceContextHeaders(headers),
        this.contextKeyRing,
        'POST',
        '/v1/privacy/access-decisions',
        this.clock(),
      );
      const request = parsePrivacyAccessDecisionBody(body);
      const result = await this.application.decide({
        ...context,
        ...request,
      });
      if (result.decision.outcome === 'denied') {
        throw deniedPrivacyDecisionException(result.decision.decisionId);
      }
      return result;
    } catch (error) {
      throw toPrivacyHttpException(error);
    }
  }

  /** Atomically consumes one exact grant before a service-local original-data read. */
  @Post('access-grants/consume')
  async consume(
    @Headers() headers: Readonly<Record<string, unknown>>,
    @Body() body: unknown,
  ): Promise<PrivacyGrantConsumptionReceipt> {
    try {
      const context = verifyPrivacyServiceContext(
        extractPrivacyServiceContextHeaders(headers),
        this.contextKeyRing,
        'POST',
        '/v1/privacy/access-grants/consume',
        this.clock(),
      );
      const request = parsePrivacyAccessConsumeBody(body);
      return await this.application.consume({
        ...context,
        ...request,
      });
    } catch (error) {
      throw toPrivacyHttpException(error);
    }
  }
}

/** Root NestJS module for the independently deployable privacy service. */
@Module({
  controllers: [PrivacyController],
  providers: [
    {
      provide: PRIVACY_RUNTIME,
      useFactory: createPrivacyRuntimeProvider,
    },
    {
      provide: PRIVACY_ACCESS_APPLICATION,
      inject: [PRIVACY_RUNTIME],
      useFactory: privacyApplicationFromRuntime,
    },
    {
      provide: PRIVACY_CONTEXT_KEY_RING,
      inject: [PRIVACY_RUNTIME],
      useFactory: privacyContextKeyRingFromRuntime,
    },
    {
      provide: PRIVACY_CLOCK,
      useFactory: createPrivacyClock,
    },
  ],
})
export class AppModule {}

export type { PrivacyAccessDecisionResult } from './privacy-access-application';
