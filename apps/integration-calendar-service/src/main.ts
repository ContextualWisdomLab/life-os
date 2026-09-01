import 'reflect-metadata';
import {
  Body,
  Controller,
  Delete,
  DynamicModule,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  CalendarConnectionCreateApplication,
  CalendarConnectionCreateDependencyError,
  type CalendarConnectionCreateResult,
  CalendarConnectionCreateValidationError,
  type CalendarConnectionProviderAuthorization,
} from './calendar-connection-create';
import {
  CalendarConnectionDisconnectApplication,
  CalendarConnectionDisconnectEvidenceError,
  type CalendarConnectionDisconnectResult,
  CalendarConnectionDisconnectValidationError,
} from './calendar-connection-disconnect';
import {
  CalendarConnectionReadApplication,
  CalendarConnectionReadEvidenceError,
  type CalendarConnectionReadResult,
  CalendarConnectionReadValidationError,
} from './calendar-connection-read';
import {
  CalendarContextInvalidError,
  CalendarContextUnavailableError,
  requireTrustedCalendarUserContext,
  requireTrustedCalendarWorkspaceContext,
} from './calendar-service-context';
import {
  CaldavCalendarProvider,
  CalendarConflictError,
  CalendarDependencyError,
  type CalendarProvider,
  CalendarSyncService,
  type CalendarSyncResult,
  CalendarValidationError,
} from './calendar-sync';
import { GoogleCalendarProvider } from './google-calendar-provider';

export const CALENDAR_SYNC_SERVICE = Symbol('CALENDAR_SYNC_SERVICE');
/** DI token for authenticated, tenant/user-scoped calendar connection creation. */
export const CALENDAR_CONNECTION_CREATE_APPLICATION = Symbol(
  'CALENDAR_CONNECTION_CREATE_APPLICATION',
);
export const CALENDAR_CONNECTION_DISCONNECT_APPLICATION = Symbol(
  'CALENDAR_CONNECTION_DISCONNECT_APPLICATION',
);
/** DI token for the authenticated, tenant/user-scoped calendar read application. */
export const CALENDAR_CONNECTION_READ_APPLICATION = Symbol(
  'CALENDAR_CONNECTION_READ_APPLICATION',
);

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
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature') signature: string | undefined,
    @Body() body: unknown,
  ): Promise<CalendarSyncResult> {
    try {
      const trustedWorkspaceId = requireTrustedCalendarWorkspaceContext(
        { workspaceId, issuedAt, signature },
        process.env.CALENDAR_GATEWAY_CONTEXT_SECRET,
      );
      return await this.calendarSyncService.sync(trustedWorkspaceId, body);
    } catch (error) {
      if (error instanceof CalendarContextInvalidError) {
        throw problem(
          401,
          'Calendar synchronization context is invalid',
          'invalid_gateway_context',
        );
      }
      if (error instanceof CalendarContextUnavailableError) {
        throw problem(
          503,
          'Calendar synchronization context is unavailable',
          'calendar_context_unavailable',
        );
      }
      if (error instanceof CalendarValidationError) {
        throw problem(
          400,
          'Calendar synchronization input is invalid',
          'invalid_request',
        );
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

/** Authenticated hosted boundary for creating user-owned calendar connections. */
@Controller()
export class CalendarConnectionCreateController {
  /** Creates the controller over the credential-safe connection creation boundary. */
  constructor(
    @Inject(CALENDAR_CONNECTION_CREATE_APPLICATION)
    private readonly createApplication: CalendarConnectionCreateApplication,
  ) {}

  /** Creates one connection only after verifying signed workspace-user authority. */
  @Post('v1/calendar/connections')
  @HttpCode(200)
  async createConnection(
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-user-id') userId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature')
    contextSignature: string | undefined,
    @Body() body: unknown,
  ): Promise<CalendarConnectionCreateResult> {
    try {
      const authority = requireTrustedCalendarUserContext(
        { workspaceId, userId, issuedAt, signature: contextSignature },
        process.env.CALENDAR_GATEWAY_CONTEXT_SECRET,
      );
      return await this.createApplication.create(
        authority,
        body as CalendarConnectionProviderAuthorization,
      );
    } catch (error) {
      if (error instanceof CalendarContextInvalidError) {
        throw problem(
          401,
          'Calendar connection context is invalid',
          'invalid_gateway_context',
        );
      }
      if (error instanceof CalendarContextUnavailableError) {
        throw problem(
          503,
          'Calendar connection context is unavailable',
          'calendar_context_unavailable',
        );
      }
      if (error instanceof CalendarConnectionCreateValidationError) {
        throw problem(
          400,
          'Calendar connection input is invalid',
          'invalid_request',
        );
      }
      if (error instanceof CalendarConnectionCreateDependencyError) {
        throw problem(
          503,
          'Calendar connection persistence is unavailable',
          'calendar_connection_unavailable',
        );
      }
      throw problem(
        503,
        'Calendar connection operation is unavailable',
        'calendar_connection_unavailable',
      );
    }
  }
}

/** Authenticated hosted boundary for reading user-owned calendar connection state. */
@Controller()
export class CalendarConnectionReadController {
  /** Creates the controller over the credential-free connection read boundary. */
  constructor(
    @Inject(CALENDAR_CONNECTION_READ_APPLICATION)
    private readonly readApplication: CalendarConnectionReadApplication,
  ) {}

  /** Reads one active owned connection without returning provider secret handles. */
  @Get('v1/calendar/connections/:connectionId')
  async getConnection(
    @Param('connectionId') connectionId: string,
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-user-id') userId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature')
    contextSignature: string | undefined,
  ): Promise<CalendarConnectionReadResult> {
    try {
      const authority = requireTrustedCalendarUserContext(
        { workspaceId, userId, issuedAt, signature: contextSignature },
        process.env.CALENDAR_GATEWAY_CONTEXT_SECRET,
      );
      const result = await this.readApplication.getActive(
        authority,
        connectionId,
      );
      if (!result) {
        throw problem(
          404,
          'Calendar connection was not found',
          'calendar_connection_not_found',
        );
      }
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (error instanceof CalendarContextInvalidError) {
        throw problem(
          401,
          'Calendar connection context is invalid',
          'invalid_gateway_context',
        );
      }
      if (error instanceof CalendarContextUnavailableError) {
        throw problem(
          503,
          'Calendar connection context is unavailable',
          'calendar_context_unavailable',
        );
      }
      if (error instanceof CalendarConnectionReadValidationError) {
        throw problem(
          400,
          'Calendar connection input is invalid',
          'invalid_request',
        );
      }
      if (error instanceof CalendarConnectionReadEvidenceError) {
        throw problem(
          503,
          'Calendar connection persistence is unavailable',
          'calendar_connection_unavailable',
        );
      }
      throw problem(
        503,
        'Calendar connection operation is unavailable',
        'calendar_connection_unavailable',
      );
    }
  }
}

/** Authenticated hosted boundary for user-owned calendar-connection lifecycle actions. */
@Controller()
export class CalendarConnectionController {
  /** Creates the controller over the application boundary only. */
  constructor(
    @Inject(CALENDAR_CONNECTION_DISCONNECT_APPLICATION)
    private readonly disconnectApplication: CalendarConnectionDisconnectApplication,
  ) {}

  /** Revokes one locally owned connection without exposing provider credentials. */
  @Delete('v1/calendar/connections/:connectionId')
  @HttpCode(200)
  async disconnectConnection(
    @Param('connectionId') connectionId: string,
    @Headers('x-life-os-workspace-id') workspaceId: string | undefined,
    @Headers('x-life-os-user-id') userId: string | undefined,
    @Headers('x-life-os-context-issued-at') issuedAt: string | undefined,
    @Headers('x-life-os-context-signature')
    contextSignature: string | undefined,
  ): Promise<CalendarConnectionDisconnectResult> {
    try {
      const authority = requireTrustedCalendarUserContext(
        { workspaceId, userId, issuedAt, signature: contextSignature },
        process.env.CALENDAR_GATEWAY_CONTEXT_SECRET,
      );
      const result = await this.disconnectApplication.disconnect(
        authority,
        connectionId,
      );
      if (!result) {
        throw problem(
          404,
          'Calendar connection was not found',
          'calendar_connection_not_found',
        );
      }
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (error instanceof CalendarContextInvalidError) {
        throw problem(
          401,
          'Calendar connection context is invalid',
          'invalid_gateway_context',
        );
      }
      if (error instanceof CalendarContextUnavailableError) {
        throw problem(
          503,
          'Calendar connection context is unavailable',
          'calendar_context_unavailable',
        );
      }
      if (error instanceof CalendarConnectionDisconnectValidationError) {
        throw problem(
          400,
          'Calendar connection input is invalid',
          'invalid_request',
        );
      }
      if (error instanceof CalendarConnectionDisconnectEvidenceError) {
        throw problem(
          503,
          'Calendar connection persistence is unavailable',
          'calendar_connection_unavailable',
        );
      }
      throw problem(
        503,
        'Calendar connection operation is unavailable',
        'calendar_connection_unavailable',
      );
    }
  }
}

@Module({})
export class CalendarAppModule {
  /**
   * Registers standalone calendar sync plus any supplied authenticated
   * user-owned connection lifecycle boundaries.
   */
  static register(
    provider: CalendarProvider,
    disconnectApplication?: CalendarConnectionDisconnectApplication,
    readApplication?: CalendarConnectionReadApplication,
    createApplication?: CalendarConnectionCreateApplication,
  ): DynamicModule {
    return {
      module: CalendarAppModule,
      controllers: [
        CalendarSyncController,
        ...(disconnectApplication ? [CalendarConnectionController] : []),
        ...(readApplication ? [CalendarConnectionReadController] : []),
        ...(createApplication ? [CalendarConnectionCreateController] : []),
      ],
      providers: [
        {
          provide: CALENDAR_SYNC_SERVICE,
          useFactory: (): CalendarSyncService =>
            new CalendarSyncService(provider),
        },
        ...(disconnectApplication
          ? [
              {
                provide: CALENDAR_CONNECTION_DISCONNECT_APPLICATION,
                useValue: disconnectApplication,
              },
            ]
          : []),
        ...(readApplication
          ? [
              {
                provide: CALENDAR_CONNECTION_READ_APPLICATION,
                useValue: readApplication,
              },
            ]
          : []),
        ...(createApplication
          ? [
              {
                provide: CALENDAR_CONNECTION_CREATE_APPLICATION,
                useValue: createApplication,
              },
            ]
          : []),
      ],
    };
  }
}

/**
 * Creates an explicitly requested standalone adapter from operator-owned
 * process configuration. Google composition here uses a process-local access
 * token and therefore is not an authorization boundary for the hosted
 * multi-user service.
 */
export function createCalendarProviderFromEnvironment(
  environment: NodeJS.ProcessEnv,
): CalendarProvider {
  const providerName = environment.CALENDAR_PROVIDER ?? 'caldav';
  if (providerName === 'google') {
    const calendarId = environment.GOOGLE_CALENDAR_ID;
    const accessToken = environment.GOOGLE_CALENDAR_ACCESS_TOKEN;
    if (!calendarId || !accessToken) {
      throw new Error('Google Calendar provider configuration is incomplete');
    }
    return new GoogleCalendarProvider({ calendarId, accessToken });
  }
  if (providerName !== 'caldav') {
    throw new Error('Calendar provider configuration is unsupported');
  }

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

/**
 * Rejects process-wide provider credentials at the hosted multi-user boundary.
 *
 * Both Google and CalDAV synchronization require authenticated user-owned
 * connection evidence plus scoped secret materialization before hosted request
 * authority can exist. Standalone operator-owned composition remains available
 * through `createCalendarProviderFromEnvironment` only.
 */
export function createHostedCalendarProviderFromEnvironment(
  environment: NodeJS.ProcessEnv,
): CalendarProvider {
  const providerName = environment.CALENDAR_PROVIDER ?? 'caldav';
  if (providerName === 'google' || providerName === 'caldav') {
    throw new Error('Hosted Calendar requires user-scoped credential authority');
  }
  throw new Error('Calendar provider configuration is unsupported');
}

async function bootstrap(): Promise<void> {
  const provider = createHostedCalendarProviderFromEnvironment(process.env);
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
