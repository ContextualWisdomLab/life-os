import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
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

export const PROPOSAL_SERVICE = Symbol('PROPOSAL_SERVICE');
export const PROPOSAL_AUDIT_APPLICATION = Symbol('PROPOSAL_AUDIT_APPLICATION');
export const AI_RUNTIME = Symbol('AI_RUNTIME');

interface ProposalGenerator {
  generateProposal(
    workspaceId: string,
    request: ProposalRequest,
  ): Promise<AuditableProposal>;
}

interface ProposalProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  code: string;
}

function problem(status: number, title: string, code: string): HttpException {
  const details: ProposalProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(details, status);
}

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
  throw problem(503, 'Proposal audit is unavailable', 'audit_unavailable');
}

@Controller()
export class AiProposalController {
  constructor(
    @Inject(PROPOSAL_SERVICE)
    private readonly proposalService: ProposalGenerator,
  ) {}

  @Get('health')
  health(): { status: 'ok'; service: 'ai-service' } {
    return { status: 'ok', service: 'ai-service' };
  }

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
      if (error instanceof ProposalAuditPersistenceError) {
        throw problem(
          503,
          'Proposal audit is unavailable',
          'audit_unavailable',
        );
      }
      throw problem(
        503,
        'Proposal generation is unavailable',
        'proposal_unavailable',
      );
    }
  }
}

@Controller()
export class AiProposalAuditController {
  constructor(
    @Inject(PROPOSAL_AUDIT_APPLICATION)
    private readonly application: ProposalAuditApplication,
  ) {}

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
      useFactory: (runtime: AiRuntime): ProposalAuditApplication =>
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

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AiProductionModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.AI_SERVICE_PORT ?? 4105), '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}
