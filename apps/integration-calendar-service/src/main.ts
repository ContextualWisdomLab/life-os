import 'reflect-metadata';
import {
  Body,
  Controller,
  DynamicModule,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Module,
  Post,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  CaldavCalendarProvider,
  CalendarConflictError,
  CalendarDependencyError,
  type CalendarProvider,
  CalendarSyncService,
  type CalendarSyncResult,
  CalendarValidationError,
} from './calendar-sync';

export const CALENDAR_SYNC_SERVICE = Symbol('CALENDAR_SYNC_SERVICE');

interface CalendarProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  code: string;
}

function problem(status: number, title: string, code: string): HttpException {
  const details: CalendarProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(details, status);
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

  @Post('v1/calendar/sync')
  @HttpCode(200)
  async sync(
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() body: unknown,
  ): Promise<CalendarSyncResult> {
    try {
      if (!workspaceId) {
        throw new CalendarValidationError();
      }
      return await this.calendarSyncService.sync(workspaceId, body);
    } catch (error) {
      if (error instanceof CalendarValidationError) {
        throw problem(400, 'Calendar synchronization input is invalid', 'invalid_request');
      }
      if (error instanceof CalendarConflictError) {
        throw problem(
          409,
          'Calendar resource changed or already exists',
          'calendar_conflict',
        );
      }
      if (error instanceof CalendarDependencyError) {
        throw problem(
          503,
          'Calendar provider is unavailable',
          'calendar_unavailable',
        );
      }
      throw problem(
        503,
        'Calendar synchronization is unavailable',
        'calendar_unavailable',
      );
    }
  }
}

@Module({})
export class CalendarAppModule {
  static register(provider: CalendarProvider): DynamicModule {
    return {
      module: CalendarAppModule,
      controllers: [CalendarSyncController],
      providers: [
        {
          provide: CALENDAR_SYNC_SERVICE,
          useFactory: (): CalendarSyncService => new CalendarSyncService(provider),
        },
      ],
    };
  }
}

/** Creates the production CalDAV adapter from secret-backed environment values. */
export function createCalendarProviderFromEnvironment(
  environment: NodeJS.ProcessEnv,
): CalendarProvider {
  const calendarUrl = environment.CALDAV_CALENDAR_URL;
  const authorization = environment.CALDAV_AUTHORIZATION;
  const allowedHosts = (environment.CALDAV_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  if (!calendarUrl || !authorization) {
    throw new Error('CalDAV provider configuration is incomplete');
  }
  return new CaldavCalendarProvider({
    calendarUrl,
    authorization,
    allowedHosts,
  });
}

async function bootstrap(): Promise<void> {
  const provider = createCalendarProviderFromEnvironment(process.env);
  const app = await NestFactory.create(CalendarAppModule.register(provider));
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.CALENDAR_SERVICE_PORT ?? 4106),
    '0.0.0.0',
  );
}

if (require.main === module) {
  void bootstrap();
}
