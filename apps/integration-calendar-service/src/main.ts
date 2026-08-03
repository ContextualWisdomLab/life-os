import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Module,
  Post,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  CalendarProviderError,
  type CalendarSyncResult,
  CalendarSyncService,
  CalendarValidationError,
  InMemoryGoogleCalendarGateway,
  parseCalendarSyncRequest,
  type GoogleCalendarGateway,
} from './calendar-sync';

export const GOOGLE_CALENDAR_GATEWAY = Symbol('GOOGLE_CALENDAR_GATEWAY');
export const CALENDAR_SYNC_SERVICE = Symbol('CALENDAR_SYNC_SERVICE');

interface CalendarProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  code: string;
}

function problem(
  status: number,
  title: string,
  code: string,
): HttpException {
  const details: CalendarProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(details, status);
}

function toCalendarHttpException(error: unknown): HttpException {
  if (error instanceof CalendarValidationError) {
    return problem(400, 'Calendar synchronization request is invalid', 'invalid_request');
  }
  if (error instanceof CalendarProviderError) {
    return problem(502, 'Calendar provider rejected the operation', 'provider_error');
  }
  return problem(
    503,
    'Calendar synchronization is unavailable',
    'calendar_unavailable',
  );
}

@Controller()
export class CalendarSyncController {
  constructor(
    @Inject(CALENDAR_SYNC_SERVICE)
    private readonly calendarSyncService: CalendarSyncService,
  ) {}

  @Get('health')
  health(): { status: 'ok'; service: 'integration-calendar-service' } {
    return { status: 'ok', service: 'integration-calendar-service' };
  }

  @Post('google/events/sync')
  async synchronizeGoogleEvent(
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() body: unknown,
  ): Promise<CalendarSyncResult> {
    try {
      if (!workspaceId) {
        throw new CalendarValidationError();
      }
      return await this.calendarSyncService.synchronize(
        workspaceId,
        parseCalendarSyncRequest(body),
      );
    } catch (error) {
      throw toCalendarHttpException(error);
    }
  }
}

@Module({
  controllers: [CalendarSyncController],
  providers: [
    {
      provide: GOOGLE_CALENDAR_GATEWAY,
      useFactory: (): GoogleCalendarGateway =>
        new InMemoryGoogleCalendarGateway(),
    },
    {
      provide: CALENDAR_SYNC_SERVICE,
      inject: [GOOGLE_CALENDAR_GATEWAY],
      useFactory: (gateway: GoogleCalendarGateway): CalendarSyncService =>
        new CalendarSyncService(gateway),
    },
  ],
})
export class CalendarAppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(CalendarAppModule);
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.CALENDAR_SERVICE_PORT ?? 4106),
    '0.0.0.0',
  );
}

if (require.main === module) {
  void bootstrap();
}
