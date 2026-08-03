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
  type AuditableProposal,
  ProposalService,
  ProposalValidationError,
  RuleBasedProposalModel,
  validateProposalRequest,
} from './proposal-service';

export const PROPOSAL_SERVICE = Symbol('PROPOSAL_SERVICE');

interface ProposalProblemDetails {
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
  const details: ProposalProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(details, status);
}

@Controller()
export class AiProposalController {
  constructor(
    @Inject(PROPOSAL_SERVICE)
    private readonly proposalService: ProposalService,
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
      throw problem(
        503,
        'Proposal generation is unavailable',
        'proposal_unavailable',
      );
    }
  }
}

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

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AiAppModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.AI_SERVICE_PORT ?? 4105), '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}
