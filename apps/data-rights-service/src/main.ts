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
  type DataExportBundle,
  DataRightsConflictError,
  DataRightsCoordinator,
  DataRightsDependencyError,
  type DataRightsParticipant,
  type DataRightsDomain,
  DataRightsValidationError,
  type DeletionResult,
  REQUIRED_DATA_RIGHTS_DOMAINS,
} from './data-rights';
import { HttpDataRightsParticipant } from './http-participant';

export const DATA_RIGHTS_COORDINATOR = Symbol('DATA_RIGHTS_COORDINATOR');

interface ProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  code: string;
}

interface DeletionRequestBody {
  readonly requestId: string;
}

interface ParticipantEnvironmentEntry {
  readonly domain: DataRightsDomain;
  readonly schemaVersion: string;
  readonly baseUrl: string;
}

function problem(status: number, title: string, code: string): HttpException {
  const details: ProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(details, status);
}

function validateDeletionRequest(value: unknown): DeletionRequestBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DataRightsValidationError();
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(record).length !== 1 ||
    !Object.hasOwn(record, 'requestId') ||
    typeof record.requestId !== 'string'
  ) {
    throw new DataRightsValidationError();
  }
  return Object.freeze({ requestId: record.requestId });
}

@Controller()
export class DataRightsController {
  constructor(
    @Inject(DATA_RIGHTS_COORDINATOR)
    private readonly coordinator: DataRightsCoordinator,
  ) {}

  @Get('health')
  health(): { status: 'ok'; service: 'data-rights-service' } {
    return { status: 'ok', service: 'data-rights-service' };
  }

  @Get('v1/data-rights/export')
  async exportWorkspace(
    @Headers('x-workspace-id') workspaceId: string | undefined,
  ): Promise<DataExportBundle> {
    try {
      if (!workspaceId) {
        throw new DataRightsValidationError();
      }
      return await this.coordinator.exportWorkspace(workspaceId);
    } catch (error) {
      return this.mapError(error);
    }
  }

  @Post('v1/data-rights/deletion')
  @HttpCode(200)
  async deleteWorkspace(
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() body: unknown,
  ): Promise<DeletionResult> {
    try {
      if (!workspaceId) {
        throw new DataRightsValidationError();
      }
      const request = validateDeletionRequest(body);
      return await this.coordinator.deleteWorkspace(
        workspaceId,
        request.requestId,
      );
    } catch (error) {
      return this.mapError(error);
    }
  }

  private mapError(error: unknown): never {
    if (error instanceof DataRightsValidationError) {
      throw problem(400, 'Data rights request is invalid', 'invalid_request');
    }
    if (error instanceof DataRightsConflictError) {
      throw problem(
        409,
        'Data rights request identifier conflicts with an earlier request',
        'request_conflict',
      );
    }
    if (error instanceof DataRightsDependencyError) {
      throw problem(
        503,
        'A required data rights participant is unavailable',
        'participant_unavailable',
      );
    }
    throw problem(
      503,
      'Data rights operation is unavailable',
      'data_rights_unavailable',
    );
  }
}

@Module({})
export class DataRightsAppModule {
  static register(participants: readonly DataRightsParticipant[]): DynamicModule {
    return {
      module: DataRightsAppModule,
      controllers: [DataRightsController],
      providers: [
        {
          provide: DATA_RIGHTS_COORDINATOR,
          useFactory: (): DataRightsCoordinator =>
            new DataRightsCoordinator(participants),
        },
      ],
    };
  }
}

function parseParticipantEntries(value: string): ParticipantEnvironmentEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('Data rights participant configuration is invalid');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Data rights participant configuration is invalid');
  }
  return parsed.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('Data rights participant configuration is invalid');
    }
    const record = entry as Readonly<Record<string, unknown>>;
    if (
      Object.keys(record).length !== 3 ||
      typeof record.domain !== 'string' ||
      !REQUIRED_DATA_RIGHTS_DOMAINS.includes(
        record.domain as DataRightsDomain,
      ) ||
      typeof record.schemaVersion !== 'string' ||
      typeof record.baseUrl !== 'string'
    ) {
      throw new Error('Data rights participant configuration is invalid');
    }
    return Object.freeze({
      domain: record.domain as DataRightsDomain,
      schemaVersion: record.schemaVersion,
      baseUrl: record.baseUrl,
    });
  });
}

/** Creates the exact required participant registry from secret-backed settings. */
export function createParticipantsFromEnvironment(
  environment: NodeJS.ProcessEnv,
): DataRightsParticipant[] {
  const serialized = environment.DATA_RIGHTS_PARTICIPANTS_JSON;
  const authorization = environment.DATA_RIGHTS_SERVICE_AUTHORIZATION;
  const allowedHosts = (environment.DATA_RIGHTS_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  if (!serialized || !authorization) {
    throw new Error('Data rights participant configuration is incomplete');
  }
  return parseParticipantEntries(serialized).map(
    (entry) =>
      new HttpDataRightsParticipant({
        ...entry,
        authorization,
        allowedHosts,
      }),
  );
}

async function bootstrap(): Promise<void> {
  const participants = createParticipantsFromEnvironment(process.env);
  const app = await NestFactory.create(DataRightsAppModule.register(participants));
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.DATA_RIGHTS_SERVICE_PORT ?? 4107),
    '0.0.0.0',
  );
}

if (require.main === module) {
  void bootstrap();
}
