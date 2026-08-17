import { mkdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import type { ArtifactFile } from './artifact-types';

export type ArtifactWriteResult = {
  created: string[];
  failed: Array<{ fileName: string; message: string }>;
};

export async function writeArtifacts(
  outputDirectory: string,
  artifacts: ArtifactFile[],
): Promise<ArtifactWriteResult> {
  const absoluteDirectory = resolve(outputDirectory);

  try {
    await mkdir(absoluteDirectory, { recursive: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      created: [],
      failed: artifacts.map(({ fileName }) => ({ fileName, message })),
    };
  }

  const results = await Promise.all(
    artifacts.map(async ({ fileName, content }) => {
      const filePath = resolve(absoluteDirectory, fileName);
      try {
        if (relative(absoluteDirectory, filePath).startsWith('..')) {
          throw new Error('Artifact path must remain inside the selected directory.');
        }
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

  return results.reduce<ArtifactWriteResult>(
    (result, item) => {
      if (typeof item.filePath === 'string') {
        result.created.push(item.filePath);
      } else {
        result.failed.push({
          fileName: item.fileName,
          message: item.error ?? 'Unknown artifact write error.',
        });
      }
      return result;
    },
    { created: [], failed: [] },
  );
}
