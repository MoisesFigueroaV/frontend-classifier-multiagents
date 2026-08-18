import { createInterface } from 'node:readline/promises';
import { stdin as inputStream, stdout as outputStream } from 'node:process';
import { resolve } from 'node:path';

import { loadLocalRepository, resolveLocalRepositoryPath } from './repository/load-local-repository';
import { runFrontendAnalysis } from './runners/run-frontend-analysis';
import { buildClassificationJson } from './artifacts/build-classification-json';
import { buildDesignReport } from './artifacts/build-design-report';
import { buildUiSkill } from './artifacts/build-ui-skill';
import type { ArtifactBuilder, ArtifactKind } from './artifacts/artifact-types';
import { writeArtifacts } from './artifacts/write-artifacts';
import { selectArtifacts } from './prompts/select-artifacts';
import { selectOutputDirectory } from './prompts/select-output-directory';
import { formatTokenUsageSummary } from '../mastra/lib/token-usage';

const artifactBuilders: Record<ArtifactKind, ArtifactBuilder> = {
  classification: buildClassificationJson,
  uiSkill: buildUiSkill,
  designReport: buildDesignReport,
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function main() {
  outputStream.write('\nFrontend Classifier\n\n');

  const readline = createInterface({
    input: inputStream,
    output: outputStream,
  });
  const repositoryPath = (
    await readline.question('¿Dónde está el proyecto? (ruta o frase)\n> ')
  ).trim();

  if (!repositoryPath) {
    readline.close();
    throw new Error('A repository path is required.');
  }

  const [snapshot, repositoryDirectory] = await Promise.all([
    loadLocalRepository(repositoryPath),
    resolveLocalRepositoryPath(repositoryPath),
  ]);
  outputStream.write(
    `\nEncontrados ${snapshot.files.length.toString()} archivos.\nAnalizando...\n`,
  );

  const analysisRun = await runFrontendAnalysis(snapshot);
  const result = analysisRun.workflowResult;

  if (result.status !== 'success') {
    outputStream.write(`\n${formatTokenUsageSummary(analysisRun.tokenUsage)}\n`);
    if (result.status === 'failed') {
      throw new Error(getErrorMessage(result.error));
    }

    throw new Error(`Analysis finished with status: ${result.status}`);
  }

  outputStream.write('\n✓ Repository inspection\n');
  outputStream.write('✓ Design extraction\n');
  outputStream.write('✓ Visual analysis\n');
  outputStream.write('✓ Component analysis\n');
  outputStream.write('✓ Layout analysis\n');
  outputStream.write('✓ Motion analysis\n');
  outputStream.write('✓ Classification\n');
  outputStream.write('\nAnálisis completado.\n');
  outputStream.write(`${result.result.overallSummary}\n`);
  outputStream.write(`\n${formatTokenUsageSummary(analysisRun.tokenUsage)}\n`);

  const selectedArtifacts = await selectArtifacts(readline);
  const defaultDirectory = resolve(process.cwd(), 'artifacts');
  const outputDirectory = await selectOutputDirectory(readline, {
    defaultDirectory,
    repositoryArtifactsDirectory: resolve(repositoryDirectory, 'artifacts'),
  });
  readline.close();

  const artifacts = selectedArtifacts.map((kind) =>
    artifactBuilders[kind](result.result),
  );
  const writeResult = await writeArtifacts(
    {
      destinationDirectory: outputDirectory,
      projectName: snapshot.projectName,
      sourcePath: repositoryDirectory,
    },
    artifacts,
  );

  if (writeResult.runDirectory) {
    outputStream.write(`\n✓ Run guardado en:\n  ${writeResult.runDirectory}\n`);
  }

  if (writeResult.created.length > 0) {
    outputStream.write('\n✓ Archivos del run:\n');
    for (const filePath of writeResult.created) {
      outputStream.write(`  ${filePath}\n`);
    }
  }

  if (writeResult.latestUpdated.length > 0) {
    outputStream.write('\n✓ Latest actualizado:\n');
    for (const filePath of writeResult.latestUpdated) {
      outputStream.write(`  ${filePath}\n`);
    }
  }

  if (writeResult.metadataPath) {
    outputStream.write(`\n✓ Metadata:\n  ${writeResult.metadataPath}\n`);
  }

  if (writeResult.failed.length > 0) {
    outputStream.write('\nNo se pudieron escribir algunos artefactos; el análisis sigue disponible en esta ejecución.\n');
    for (const failure of writeResult.failed) {
      outputStream.write(`  ${failure.fileName}: ${failure.message}\n`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(`\nError: ${getErrorMessage(error)}`);
  process.exitCode = 1;
});
