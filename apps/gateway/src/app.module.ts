import { Controller, Get, Module } from '@nestjs/common';

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
}

@Module({
  controllers: [HealthController],
})
export class AppModule {}
