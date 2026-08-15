import { createInterface } from 'node:readline/promises';
import { stdin as inputStream, stdout as outputStream } from 'node:process';

import { loadLocalRepository } from './repository/load-local-repository';
import { runFrontendAnalysis } from './runners/run-frontend-analysis';

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
  readline.close();

  if (!repositoryPath) {
    throw new Error('A repository path is required.');
  }

  const snapshot = await loadLocalRepository(repositoryPath);
  outputStream.write(
    `\nEncontrados ${snapshot.files.length.toString()} archivos.\nAnalizando...\n`,
  );

  const result = await runFrontendAnalysis(snapshot);

  if (result.status !== 'success') {
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
}

main().catch((error: unknown) => {
  console.error(`\nError: ${getErrorMessage(error)}`);
  process.exitCode = 1;
});
