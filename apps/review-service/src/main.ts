import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Module,
  Post,
  Query,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  requireHistoryLimit,
  requireReviewGatewayContextSecret,
  requireTrustedWorkspaceContext,
  toReviewHttpException,
} from './http-boundary';
import {
  type ReviewCompletionRecord,
  ReviewService,
  type ReviewRitualKind,
} from './review-domain';
import { createReviewRuntime, ReviewRuntime } from './review-runtime';

/** Dependency-injection token for the production review runtime. */
export const REVIEW_RUNTIME = Symbol('REVIEW_RUNTIME');
/** Dependency-injection token for the guided review domain service. */
export const REVIEW_SERVICE = Symbol('REVIEW_SERVICE');

/** Exposes immutable guided-review completions and tenant-scoped history. */
@Controller()
export class ReviewController {
  constructor(
    @Inject(REVIEW_SERVICE)
    private readonly reviewService: ReviewService,
  ) {}

  /** Returns a credential-free liveness response for the review service. */
  @Get('health')
  health(): { status: 'ok'; service: 'review-service' } {
    return { status: 'ok', service: 'review-service' };
  }

  /** Returns readiness only when signed workspace authority can be verified. */
  @Get('ready')
  ready(): { status: 'ready'; service: 'review-service' } {
    requireReviewGatewayContextSecret(
      process.env.REVIEW_GATEWAY_CONTEXT_SECRET,
    );
    return { status: 'ready', service: 'review-service' };
  }

  /** Records a completed daily planning ritual. */
  @Post('reviews/daily-planning/completions')
  async completeDailyPlanning(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Body() body: unknown,
  ): Promise<ReviewCompletionRecord> {
    const trustedWorkspaceId = requireTrustedWorkspaceContext(
      { workspaceId, issuedAt, signature },
      process.env.REVIEW_GATEWAY_CONTEXT_SECRET,
    );
    return await this.complete(trustedWorkspaceId, 'daily-planning', body);
  }

  /** Records a completed daily shutdown ritual. */
  @Post('reviews/daily-shutdown/completions')
  async completeDailyShutdown(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Body() body: unknown,
  ): Promise<ReviewCompletionRecord> {
    const trustedWorkspaceId = requireTrustedWorkspaceContext(
      { workspaceId, issuedAt, signature },
      process.env.REVIEW_GATEWAY_CONTEXT_SECRET,
    );
    return await this.complete(trustedWorkspaceId, 'daily-shutdown', body);
  }

  /** Records a completed Monday-anchored weekly review ritual. */
  @Post('reviews/weekly-review/completions')
  async completeWeeklyReview(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Body() body: unknown,
  ): Promise<ReviewCompletionRecord> {
    const trustedWorkspaceId = requireTrustedWorkspaceContext(
      { workspaceId, issuedAt, signature },
      process.env.REVIEW_GATEWAY_CONTEXT_SECRET,
    );
    return await this.complete(trustedWorkspaceId, 'weekly-review', body);
  }

  /** Lists deterministic immutable completion history for one workspace. */
  @Get('reviews/completions')
  async listCompletions(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Query('limit') limit: string | undefined,
  ): Promise<ReviewCompletionRecord[]> {
    try {
      const trustedWorkspaceId = requireTrustedWorkspaceContext(
        { workspaceId, issuedAt, signature },
        process.env.REVIEW_GATEWAY_CONTEXT_SECRET,
      );
      return await this.reviewService.list(
        trustedWorkspaceId,
        requireHistoryLimit(limit),
      );
    } catch (error) {
      throw toReviewHttpException(error);
    }
  }

  /** Records one ritual only for a workspace ID already accepted by the trusted-context verifier. */
  private async complete(
    workspaceId: string,
    ritualKind: ReviewRitualKind,
    body: unknown,
  ): Promise<ReviewCompletionRecord> {
    try {
      return await this.reviewService.complete(workspaceId, ritualKind, body);
    } catch (error) {
      throw toReviewHttpException(error);
    }
  }
}

/** Root NestJS module for the production review-service process. */
@Module({
  controllers: [ReviewController],
  providers: [
    {
      provide: REVIEW_RUNTIME,
      useFactory: (): ReviewRuntime => createReviewRuntime(process.env),
    },
    {
      provide: REVIEW_SERVICE,
      inject: [REVIEW_RUNTIME],
      useFactory: (runtime: ReviewRuntime): ReviewService => runtime.service,
    },
  ],
})
export class AppModule {}

/** Verifies required security configuration before Review accepts traffic. */
export function requireReviewServiceConfiguration(
  env: NodeJS.ProcessEnv,
): void {
  requireReviewGatewayContextSecret(env.REVIEW_GATEWAY_CONTEXT_SECRET);
}

/** Boots the versioned review service on its configured public port. */
async function bootstrap(): Promise<void> {
  requireReviewServiceConfiguration(process.env);
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  await app.listen(Number(process.env.REVIEW_SERVICE_PORT ?? 4104), '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}
