import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';

import type { ArtifactFile } from './artifact-types';

type ArtifactPersistenceOptions = {
  destinationDirectory: string;
  projectName: string;
  sourcePath?: string;
};

export type ArtifactWriteResult = {
  runDirectory?: string;
  latestDirectory?: string;
  metadataPath?: string;
  created: string[];
  latestUpdated: string[];
  failed: Array<{ fileName: string; message: string }>;
};

function safeDirectoryName(value: string) {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return sanitized || 'unnamed-project';
}

function safeTimestamp(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-');
}

function resolveInside(parentDirectory: string, ...parts: string[]) {
  const target = resolve(parentDirectory, ...parts);
  const relativePath = relative(parentDirectory, target);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error('Artifact path must remain inside the selected directory.');
  }
  return target;
}

async function createRunDirectory(runsDirectory: string, generatedAt: Date) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const runId = randomUUID();
    const runDirectory = resolveInside(
      runsDirectory,
      `${safeTimestamp(generatedAt)}-${runId.slice(0, 8)}`,
    );

    try {
      await mkdir(runDirectory);
      return { runDirectory, runId };
    } catch (error: unknown) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  throw new Error('Could not allocate a unique artifact run directory.');
}

export async function writeArtifacts(
  options: ArtifactPersistenceOptions,
  artifacts: ArtifactFile[],
): Promise<ArtifactWriteResult> {
  const destinationDirectory = resolve(options.destinationDirectory);
  const projectDirectory = resolveInside(
    destinationDirectory,
    safeDirectoryName(options.projectName),
  );
  const runsDirectory = resolveInside(projectDirectory, 'runs');
  const latestDirectory = resolveInside(projectDirectory, 'latest');
  const generatedAt = new Date();

  try {
    await mkdir(runsDirectory, { recursive: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      created: [],
      latestUpdated: [],
      failed: artifacts.map(({ fileName }) => ({ fileName, message })),
    };
  }

  let run: { runDirectory: string; runId: string };
  try {
    run = await createRunDirectory(runsDirectory, generatedAt);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      created: [],
      latestUpdated: [],
      failed: artifacts.map(({ fileName }) => ({ fileName, message })),
    };
  }

  const results = await Promise.all(
    artifacts.map(async ({ fileName, content }) => {
      const filePath = resolveInside(run.runDirectory, fileName);
      try {
        await writeFile(filePath, content, 'utf8');
        return { fileName, filePath };
      } catch (error: unknown) {
        return {
          fileName,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  const created = results.flatMap((item) =>
    typeof item.filePath === 'string' ? [item.filePath] : [],
  );
  const failed = results.flatMap((item) =>
    typeof item.filePath === 'string'
      ? []
      : [{ fileName: item.fileName, message: item.error ?? 'Unknown artifact write error.' }],
  );
  const metadataPath = resolveInside(run.runDirectory, 'metadata.json');

  try {
    await writeFile(
      metadataPath,
      `${JSON.stringify({
        projectName: options.projectName,
        generatedAt: generatedAt.toISOString(),
        runId: run.runId,
        artifacts: created.map((filePath) => filePath.split(sep).at(-1)),
        ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
      }, null, 2)}\n`,
      'utf8',
    );
  } catch (error: unknown) {
    failed.push({
      fileName: 'metadata.json',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const latestUpdated: string[] = [];
  try {
    await rm(latestDirectory, { recursive: true, force: true });
    await mkdir(latestDirectory, { recursive: true });
    await Promise.all(
      created.map(async (runFilePath) => {
        const fileName = runFilePath.split(sep).at(-1);
        if (!fileName) return;
        const latestFilePath = resolveInside(latestDirectory, fileName);
        await copyFile(runFilePath, latestFilePath);
        latestUpdated.push(latestFilePath);
      }),
    );
  } catch (error: unknown) {
    failed.push({
      fileName: 'latest',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    runDirectory: run.runDirectory,
    latestDirectory,
    ...(failed.some((item) => item.fileName === 'metadata.json') ? {} : { metadataPath }),
    created,
    latestUpdated,
    failed,
  };
}
