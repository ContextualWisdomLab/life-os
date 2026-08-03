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
  requireWorkspaceHeader,
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

  /** Records a completed daily planning ritual. */
  @Post('reviews/daily-planning/completions')
  async completeDailyPlanning(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Body() body: unknown,
  ): Promise<ReviewCompletionRecord> {
    return await this.complete(workspaceHeader, 'daily-planning', body);
  }

  /** Records a completed daily shutdown ritual. */
  @Post('reviews/daily-shutdown/completions')
  async completeDailyShutdown(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Body() body: unknown,
  ): Promise<ReviewCompletionRecord> {
    return await this.complete(workspaceHeader, 'daily-shutdown', body);
  }

  /** Records a completed Monday-anchored weekly review ritual. */
  @Post('reviews/weekly-review/completions')
  async completeWeeklyReview(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Body() body: unknown,
  ): Promise<ReviewCompletionRecord> {
    return await this.complete(workspaceHeader, 'weekly-review', body);
  }

  /** Lists deterministic immutable completion history for one workspace. */
  @Get('reviews/completions')
  async listCompletions(
    @Headers('x-workspace-id') workspaceHeader: string | undefined,
    @Query('limit') limit: string | undefined,
  ): Promise<ReviewCompletionRecord[]> {
    try {
      return await this.reviewService.list(
        requireWorkspaceHeader(workspaceHeader),
        requireHistoryLimit(limit),
      );
    } catch (error) {
      throw toReviewHttpException(error);
    }
  }

  private async complete(
    workspaceHeader: string | undefined,
    ritualKind: ReviewRitualKind,
    body: unknown,
  ): Promise<ReviewCompletionRecord> {
    try {
      return await this.reviewService.complete(
        requireWorkspaceHeader(workspaceHeader),
        ritualKind,
        body,
      );
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

/** Boots the versioned review service on its configured public port. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  await app.listen(Number(process.env.REVIEW_SERVICE_PORT ?? 4104), '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}
