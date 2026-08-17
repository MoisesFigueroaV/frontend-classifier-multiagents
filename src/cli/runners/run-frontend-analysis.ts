import { mastra } from '../../mastra/index';
import { RequestContext } from '@mastra/core/request-context';
import { getTokenUsageSummary } from '../../mastra/lib/token-usage';
import type { RepositorySnapshot } from '../repository/repository-snapshot';

export async function runFrontendAnalysis(snapshot: RepositorySnapshot) {
  const workflow = mastra.getWorkflow('frontendAnalysisWorkflow');
  const run = await workflow.createRun();
  const requestContext = new RequestContext();
  const workflowResult = await run.start({ inputData: snapshot, requestContext });

  return {
    workflowResult,
    tokenUsage: getTokenUsageSummary(requestContext),
  };
}
