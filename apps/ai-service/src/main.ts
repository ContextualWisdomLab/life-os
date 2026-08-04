import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Logger,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AiRuntime, createAiRuntime } from './ai-runtime';
import {
  ProposalAuditApplication,
  ProposalAuditNotFoundError,
  validateProposalDecisionRequest,
} from './proposal-audit-application';
import {
  type ProposalAuditRecord,
  ProposalAuditValidationError,
  ProposalDigestMismatchError,
  type ProposalDecisionEvent,
} from './proposal-audit-domain';
import {
  type AuditableProposal,
  type ProposalRequest,
  ProposalService,
  ProposalValidationError,
  RuleBasedProposalModel,
  validateProposalRequest,
} from './proposal-service';
import {
  ProposalAuditPersistenceError,
  ProposalDecisionConflictError,
} from './postgres-proposal-audit-repository';

/** Injection token for the narrowed inert proposal-generation contract. */
export const PROPOSAL_SERVICE = Symbol('PROPOSAL_SERVICE');
/** Injection token for the complete append-only proposal-audit application. */
export const PROPOSAL_AUDIT_APPLICATION = Symbol('PROPOSAL_AUDIT_APPLICATION');
/** Injection token owning the shared PostgreSQL-backed production runtime. */
export const AI_RUNTIME = Symbol('AI_RUNTIME');

const auditLogger = new Logger('AiProposalAudit');

/** Narrow read-only proposal-generation contract exposed to the legacy controller. */
export interface ProposalGenerator {
  /** Generates an inert proposal without executing any proposed operation. */
  generateProposal(
    workspaceId: string,
    request: ProposalRequest,
  ): Promise<AuditableProposal>;
}

/** Credential-free RFC 9457-compatible problem response. */
interface ProposalProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  code: string;
}

/** Creates one sanitized HTTP problem with a stable machine-readable code. */
function problem(status: number, title: string, code: string): HttpException {
  const details: ProposalProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(details, status);
}

/** Maps proposal-audit failures to stable credential-free HTTP problems. */
function mapAuditError(error: unknown): never {
  if (
    error instanceof ProposalValidationError ||
    error instanceof ProposalAuditValidationError
  ) {
    throw problem(400, 'Proposal audit request is invalid', 'invalid_request');
  }
  if (error instanceof ProposalAuditNotFoundError) {
    throw problem(404, 'Proposal was not found', 'proposal_not_found');
  }
  if (error instanceof ProposalDigestMismatchError) {
    throw problem(409, 'Proposal revision is stale', 'stale_proposal');
  }
  if (error instanceof ProposalDecisionConflictError) {
    throw problem(
      409,
      'Decision idempotency key conflicts with an earlier request',
      'idempotency_conflict',
    );
  }
  if (error instanceof ProposalAuditPersistenceError) {
    throw problem(503, 'Proposal audit is unavailable', 'audit_unavailable');
  }
  const errorKind = error instanceof Error ? error.name : typeof error;
  auditLogger.error(`Unclassified proposal audit failure (${errorKind})`);
  throw problem(503, 'Proposal audit is unavailable', 'audit_unavailable');
}

/** Exposes health and inert proposal generation. */
@Controller()
export class AiProposalController {
  /** Creates a controller over the deliberately narrowed generation contract. */
  constructor(
    @Inject(PROPOSAL_SERVICE)
    private readonly proposalService: ProposalGenerator,
  ) {}

  /** Returns a credential-free liveness response. */
  @Get('health')
  health(): { status: 'ok'; service: 'ai-service' } {
    return { status: 'ok', service: 'ai-service' };
  }

  /** Generates and persists one inert proposal for the trusted workspace scope. */
  @Post('v1/proposals')
  async createProposal(
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() body: unknown,
  ): Promise<AuditableProposal> {
    try {
      if (!workspaceId) {
        throw new ProposalValidationError();
      }
      return await this.proposalService.generateProposal(
        workspaceId,
        validateProposalRequest(body),
      );
    } catch (error) {
      if (error instanceof ProposalValidationError) {
        throw problem(400, 'Proposal request is invalid', 'invalid_request');
      }
      if (
        error instanceof ProposalAuditValidationError ||
        error instanceof ProposalAuditPersistenceError
      ) {
        return mapAuditError(error);
      }
      const errorKind = error instanceof Error ? error.name : typeof error;
      auditLogger.error(
        `Unclassified proposal generation failure (${errorKind})`,
      );
      throw problem(
        503,
        'Proposal generation is unavailable',
        'proposal_unavailable',
      );
    }
  }
}

/** Exposes tenant-scoped immutable proposal and append-only decision evidence. */
@Controller()
export class AiProposalAuditController {
  /** Creates a controller over the complete audit application contract. */
  constructor(
    @Inject(PROPOSAL_AUDIT_APPLICATION)
    private readonly application: ProposalAuditApplication,
  ) {}

  /** Lists deterministic proposal evidence for the trusted workspace. */
  @Get('v1/proposals')
  async listProposals(
    @Headers('x-workspace-id') workspaceId: string | undefined,
  ): Promise<ProposalAuditRecord[]> {
    try {
      if (!workspaceId) {
        throw new ProposalAuditValidationError();
      }
      return await this.application.listProposals(workspaceId);
    } catch (error) {
      return mapAuditError(error);
    }
  }

  /** Returns one immutable proposal revision within the trusted workspace. */
  @Get('v1/proposals/:proposalId')
  async findProposal(
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('proposalId') proposalId: string,
  ): Promise<ProposalAuditRecord> {
    try {
      if (!workspaceId) {
        throw new ProposalAuditValidationError();
      }
      return await this.application.findProposal(workspaceId, proposalId);
    } catch (error) {
      return mapAuditError(error);
    }
  }

  /** Lists append-only decisions for one workspace-owned proposal revision. */
  @Get('v1/proposals/:proposalId/decisions')
  async listDecisions(
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('proposalId') proposalId: string,
  ): Promise<ProposalDecisionEvent[]> {
    try {
      if (!workspaceId) {
        throw new ProposalAuditValidationError();
      }
      return await this.application.listDecisions(workspaceId, proposalId);
    } catch (error) {
      return mapAuditError(error);
    }
  }

  /** Appends an explicit accept or reject event without executing operations. */
  @Post('v1/proposals/:proposalId/decisions')
  async appendDecision(
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Headers('x-actor-id') actorId: string | undefined,
    @Param('proposalId') proposalId: string,
    @Body() body: unknown,
  ): Promise<ProposalDecisionEvent> {
    try {
      if (!workspaceId || !actorId) {
        throw new ProposalAuditValidationError();
      }
      return await this.application.appendDecision(
        workspaceId,
        proposalId,
        actorId,
        validateProposalDecisionRequest(body),
      );
    } catch (error) {
      return mapAuditError(error);
    }
  }
}

/** Dependency-free module retained for domain and no-silent-mutation tests. */
@Module({
  controllers: [AiProposalController],
  providers: [
    {
      provide: PROPOSAL_SERVICE,
      useFactory: (): ProposalService =>
        new ProposalService(new RuleBasedProposalModel()),
    },
  ],
})
export class AiAppModule {}

/** Production module with one shared PostgreSQL-backed audit runtime. */
@Module({
  controllers: [AiProposalController, AiProposalAuditController],
  providers: [
    {
      provide: AI_RUNTIME,
      useFactory: (): AiRuntime => createAiRuntime(),
    },
    {
      provide: PROPOSAL_SERVICE,
      // Expose only ProposalGenerator while reusing the shared audit application.
      useFactory: (runtime: AiRuntime): ProposalGenerator =>
        runtime.application,
      inject: [AI_RUNTIME],
    },
    {
      provide: PROPOSAL_AUDIT_APPLICATION,
      useFactory: (runtime: AiRuntime): ProposalAuditApplication =>
        runtime.application,
      inject: [AI_RUNTIME],
    },
  ],
})
export class AiProductionModule {}

/** Minimal Nest application behavior needed by the AI process bootstrap. */
export interface AiBootstrapApplication {
  /** Enables Nest-managed lifecycle shutdown hooks. */
  enableShutdownHooks(): void;
  /** Starts the HTTP server on one validated port and fixed host. */
  listen(port: number, host: string): Promise<unknown>;
}

/** Factory used to construct the production Nest application. */
export type AiApplicationFactory = () => Promise<AiBootstrapApplication>;

/** Creates the production Nest application without starting its listener. */
export async function createAiApplication(): Promise<AiBootstrapApplication> {
  return await NestFactory.create(AiProductionModule);
}

/** Parses the optional AI service port into the supported TCP range. */
export function resolveAiServicePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return 4_105;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('AI service port is invalid');
  }
  return parsed;
}

/** Boots the production AI process with exactly-once shutdown hooks. */
export async function bootstrapAiService(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  applicationFactory: AiApplicationFactory = createAiApplication,
): Promise<void> {
  const port = resolveAiServicePort(environment.AI_SERVICE_PORT);
  const app = await applicationFactory();
  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');
}
