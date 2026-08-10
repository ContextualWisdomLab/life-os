import {
  Controller,
  Get,
  Header,
  Headers,
  HttpException,
  Module,
  Query,
} from '@nestjs/common';
import { PROMETHEUS_CONTENT_TYPE } from '@life-os/observability';
import { gatewayMetrics } from './observability';
import {
  composeToday,
  GatewayTodayError,
  type GatewayTodayView,
} from './today-composition';

/** Bounded problem details returned without dependency or credential details. */
interface GatewayProblemDetails {
  readonly type: 'about:blank';
  readonly title: string;
  readonly status: number;
  readonly code: string;
}

/** Builds one credential-free gateway problem response. */
function problem(status: number, title: string, code: string): HttpException {
  const details: GatewayProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(details, status);
}

/** Exposes operational health, authenticated Today composition, and bounded metrics. */
@Controller()
export class HealthController {
  /** Returns a credential-free liveness response for the gateway process. */
  @Get('health')
  health(): { status: 'ok'; service: 'gateway' } {
    return { status: 'ok', service: 'gateway' };
  }

  /**
   * Authenticates through Identity and composes validated Planning and optional
   * Habit evidence. Missing optional Habit configuration is reported explicitly.
   */
  @Get('today')
  @Header('Cache-Control', 'no-store')
  async today(
    @Headers('cookie') cookie: string | undefined,
    @Query('date') date: string | undefined,
  ): Promise<GatewayTodayView> {
    try {
      return await composeToday(cookie, date ?? '', process.env);
    } catch (error) {
      if (error instanceof GatewayTodayError) {
        throw problem(error.status, error.message, error.code);
      }
      throw problem(
        503,
        'Today composition is unavailable',
        'today_composition_unavailable',
      );
    }
  }

  /** Renders the bounded in-memory metrics registry for Prometheus scrapes. */
  @Get('metrics')
  @Header('Content-Type', PROMETHEUS_CONTENT_TYPE)
  metrics(): string {
    return gatewayMetrics.renderPrometheus();
  }
}

/** Root NestJS module for the LifeOS gateway. */
@Module({
  controllers: [HealthController],
})
export class AppModule {}
