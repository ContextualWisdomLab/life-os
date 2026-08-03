import { Controller, Get, Header, Module } from '@nestjs/common';
import { PROMETHEUS_CONTENT_TYPE } from '@life-os/observability';
import { gatewayMetrics } from './observability';

/** Response contract for the gateway's initial Today composition endpoint. */
interface TodayResponse {
  readonly tasks: unknown[];
  readonly habits: unknown[];
  readonly message: string;
}

/** Exposes operational health, initial composition, and bounded metrics routes. */
@Controller()
class HealthController {
  /** Returns a credential-free liveness response for the gateway process. */
  @Get('health')
  health(): { status: 'ok'; service: 'gateway' } {
    return { status: 'ok', service: 'gateway' };
  }

  /** Returns the current placeholder Today composition contract. */
  @Get('today')
  today(): TodayResponse {
    return {
      tasks: [],
      habits: [],
      message:
        'Today composition endpoint is ready for domain-service integration.',
    };
  }

  /** Renders the bounded in-memory metrics registry for Prometheus scrapes. */
  @Get('metrics')
  @Header('Content-Type', PROMETHEUS_CONTENT_TYPE)
  metrics(): string {
    return gatewayMetrics.renderPrometheus();
  }
}

@Module({
  controllers: [HealthController],
})
/** Root NestJS module for the LifeOS gateway. */
export class AppModule {}
