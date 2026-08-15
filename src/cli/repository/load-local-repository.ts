import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

import type {
  RepositoryFile,
  RepositorySnapshot,
} from './repository-snapshot';

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);
const MAX_FILE_SIZE_BYTES = 1_000_000;
const MAX_FILES = 2_000;

function isBinary(content: Buffer) {
  return content.includes(0);
}

function toRepositoryPath(repositoryPath: string, filePath: string) {
  return relative(repositoryPath, filePath).split(sep).join('/');
}

function cleanPathCandidate(value: string) {
  return value
    .trim()
    .replace(/^["'`]+|["'`.,;:!?]+$/g, '');
}

function getPathCandidates(input: string) {
  const candidates = new Set<string>();
  const addCandidate = (value: string | undefined) => {
    const candidate = cleanPathCandidate(value ?? '');
    if (candidate) candidates.add(candidate);
  };

  addCandidate(input);
  addCandidate(
    input.match(/\b(?:en|ruta|ubicación|ubicacion|path)\s+(?:es\s+)?(.+)$/i)?.[1],
  );

  for (const match of input.matchAll(
    /(?:~\/|\/|\.{1,2}\/|(?:documents|desktop|downloads)\/)[^\s"'`]+/gi,
  )) {
    addCandidate(match[0]);
  }

  return [...candidates].flatMap((candidate) => {
    if (candidate.startsWith('~/')) {
      return [resolve(homedir(), candidate.slice(2))];
    }

    if (isAbsolute(candidate)) return [candidate];

    const resolvedFromCurrentDirectory = resolve(candidate);
    if (/^(documents|desktop|downloads)\//i.test(candidate)) {
      return [resolvedFromCurrentDirectory, resolve(homedir(), candidate)];
    }

    return [resolvedFromCurrentDirectory];
  });
}

export async function resolveLocalRepositoryPath(input: string) {
  for (const candidate of getPathCandidates(input)) {
    try {
      const absolutePath = await realpath(candidate);
      const stats = await lstat(absolutePath);

      if (stats.isDirectory()) return absolutePath;
    } catch (error: unknown) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  throw new Error(
    `No repository directory was found in: "${input}".`,
  );
}

async function collectFiles(
  directoryPath: string,
  repositoryPath: string,
  files: RepositoryFile[],
) {
  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (files.length >= MAX_FILES) {
      throw new Error(
        `Repository exceeds the ${MAX_FILES.toString()} file analysis limit.`,
      );
    }

    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        await collectFiles(
          resolve(directoryPath, entry.name),
          repositoryPath,
          files,
        );
      }
      continue;
    }

    if (!entry.isFile() || entry.isSymbolicLink()) continue;

    const filePath = resolve(directoryPath, entry.name);
    const stats = await lstat(filePath);
    if (stats.size > MAX_FILE_SIZE_BYTES) continue;

    const content = await readFile(filePath);
    if (isBinary(content)) continue;

    files.push({
      path: toRepositoryPath(repositoryPath, filePath),
      content: content.toString('utf8'),
    });
  }
}

export async function loadLocalRepository(
  repositoryPath: string,
): Promise<RepositorySnapshot> {
  const absolutePath = await resolveLocalRepositoryPath(repositoryPath);

  const files: RepositoryFile[] = [];
  await collectFiles(absolutePath, absolutePath, files);

  return {
    projectName: basename(absolutePath),
    files,
  };
}
