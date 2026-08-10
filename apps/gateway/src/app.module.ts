import { Controller, Get, Header, HttpException, Module } from '@nestjs/common';
import { PROMETHEUS_CONTENT_TYPE } from '@life-os/observability';
import { gatewayMetrics } from './observability';

/** Bounded problem details returned while the real Today composition is unavailable. */
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

/** Exposes operational health and bounded metrics while product composition stays fail-closed. */
@Controller()
export class HealthController {
  /** Returns a credential-free liveness response for the gateway process. */
  @Get('health')
  health(): { status: 'ok'; service: 'gateway' } {
    return { status: 'ok', service: 'gateway' };
  }

  /** Refuses to fabricate Today data until authenticated service composition is configured. */
  @Get('today')
  today(): never {
    throw problem(
      503,
      'Today composition is unavailable',
      'today_composition_unavailable',
    );
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
