import { Controller, Get, Header, Module } from '@nestjs/common';
import { PROMETHEUS_CONTENT_TYPE } from '@life-os/observability';
import { gatewayMetrics } from './observability';

@Controller()
class HealthController {
  @Get('health')
  health(): { status: 'ok'; service: 'gateway' } {
    return { status: 'ok', service: 'gateway' };
  }

  @Get('today')
  today(): { tasks: unknown[]; habits: unknown[]; message: string } {
    return {
      tasks: [],
      habits: [],
      message: 'Today composition endpoint is ready for domain-service integration.',
    };
  }

  @Get('metrics')
  @Header('Content-Type', PROMETHEUS_CONTENT_TYPE)
  metrics(): string {
    return gatewayMetrics.renderPrometheus();
  }
}

@Module({
  controllers: [HealthController],
})
export class AppModule {}
