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
  AiGatewayContextError,
  requireTrustedAiContext,
  type TrustedAiContext,
} from './gateway-context';
import {
  ProposalAuditApplication,
  ProposalAuditNotFoundError,
  validateProposalDecisionRequest,
} from './proposal-audit-application';
import {
  type ProposalAuditRecord,
  ProposalAuditValidationError,
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
  ProposalDigestMismatchError,
} from './postgres-proposal-audit-repository';

/** Injection token for the narrowed inert proposal-generation contract. */
export const PROPOSAL_SERVICE = Symbol('PROPOSAL_SERVICE');
/** Injection token for the complete append-only proposal-audit application. */
export const PROPOSAL_AUDIT_APPLICATION = Symbol('PROPOSAL_AUDIT_APPLICATION');
/** Injection token owning the shared PostgreSQL-backed production runtime. */
export const AI_RUNTIME = Symbol('AI_RUNTIME');

const auditLogger = new Logger('AiProposalAudit');

/** Narrow read-only proposal-generation contract exposed to the legacy controller. */
interface ProposalGenerator {
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

/** Derives actor and workspace scope only from the signed private-gateway context. */
function trustedAiContext(
  headers: Readonly<Record<string, unknown>>,
): TrustedAiContext {
  return requireTrustedAiContext(
    {
      workspaceId: headers['x-life-os-workspace-id'],
      actorId: headers['x-life-os-actor-id'],
      issuedAt: headers['x-life-os-context-issued-at'],
      signature: headers['x-life-os-context-signature'],
    },
    process.env.AI_GATEWAY_CONTEXT_SECRET,
  );
}

/** Maps proposal-audit and gateway failures to stable credential-free HTTP problems. */
function mapAuditError(error: unknown): never {
  if (error instanceof AiGatewayContextError) {
    if (error.failure === 'invalid_gateway_context') {
      throw problem(
        401,
        'Trusted gateway context is invalid',
        'invalid_gateway_context',
      );
    }
    throw problem(
      503,
      'Trusted gateway context is unavailable',
      'gateway_context_unavailable',
    );
  }
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

  /** Generates and persists one inert proposal for the authenticated workspace. */
  @Post('v1/proposals')
  async createProposal(
    @Headers() headers: Readonly<Record<string, unknown>>,
    @Body() body: unknown,
  ): Promise<AuditableProposal> {
    try {
      const context = trustedAiContext(headers);
      return await this.proposalService.generateProposal(
        context.workspaceId,
        validateProposalRequest(body),
      );
    } catch (error) {
      if (error instanceof ProposalValidationError) {
        throw problem(400, 'Proposal request is invalid', 'invalid_request');
      }
      if (
        error instanceof AiGatewayContextError ||
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

  /** Lists deterministic proposal evidence for the authenticated workspace. */
  @Get('v1/proposals')
  async listProposals(
    @Headers() headers: Readonly<Record<string, unknown>>,
  ): Promise<ProposalAuditRecord[]> {
    try {
      return await this.application.listProposals(
        trustedAiContext(headers).workspaceId,
      );
    } catch (error) {
      return mapAuditError(error);
    }
  }

  /** Returns one immutable proposal revision within the authenticated workspace. */
  @Get('v1/proposals/:proposalId')
  async findProposal(
    @Headers() headers: Readonly<Record<string, unknown>>,
    @Param('proposalId') proposalId: string,
  ): Promise<ProposalAuditRecord> {
    try {
      return await this.application.findProposal(
        trustedAiContext(headers).workspaceId,
        proposalId,
      );
    } catch (error) {
      return mapAuditError(error);
    }
  }

  /** Lists append-only decisions for one authenticated workspace proposal. */
  @Get('v1/proposals/:proposalId/decisions')
  async listDecisions(
    @Headers() headers: Readonly<Record<string, unknown>>,
    @Param('proposalId') proposalId: string,
  ): Promise<ProposalDecisionEvent[]> {
    try {
      return await this.application.listDecisions(
        trustedAiContext(headers).workspaceId,
        proposalId,
      );
    } catch (error) {
      return mapAuditError(error);
    }
  }

  /** Appends an explicit signed-actor decision without executing operations. */
  @Post('v1/proposals/:proposalId/decisions')
  async appendDecision(
    @Headers() headers: Readonly<Record<string, unknown>>,
    @Param('proposalId') proposalId: string,
    @Body() body: unknown,
  ): Promise<ProposalDecisionEvent> {
    try {
      const context = trustedAiContext(headers);
      return await this.application.appendDecision(
        context.workspaceId,
        proposalId,
        context.actorId,
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

/** Boots the production AI process with exactly-once shutdown hooks. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AiProductionModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.AI_SERVICE_PORT ?? 4105), '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}
