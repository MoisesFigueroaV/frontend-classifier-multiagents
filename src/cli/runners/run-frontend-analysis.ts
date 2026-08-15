import { mastra } from '../../mastra/index';
import type { RepositorySnapshot } from '../repository/repository-snapshot';

export async function runFrontendAnalysis(snapshot: RepositorySnapshot) {
  const workflow = mastra.getWorkflow('frontendAnalysisWorkflow');
  const run = await workflow.createRun();

  return run.start({ inputData: snapshot });
}
