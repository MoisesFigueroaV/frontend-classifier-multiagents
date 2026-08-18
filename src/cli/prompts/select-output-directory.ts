import { resolve } from 'node:path';
import type { Interface } from 'node:readline/promises';
import { homedir } from 'node:os';

const choices = (defaultDirectory: string, repositoryArtifactsDirectory: string) =>
  `\n¿Dónde deseas guardarlos?\n  1. Carpeta por defecto: ${defaultDirectory}\n  2. Dentro del repositorio analizado: ${repositoryArtifactsDirectory}\n  3. Ruta personalizada\n> `;

export async function selectOutputDirectory(
  readline: Interface,
  options: { defaultDirectory: string; repositoryArtifactsDirectory: string },
) {
  while (true) {
    const answer = (await readline.question(
      choices(options.defaultDirectory, options.repositoryArtifactsDirectory),
    ))
      .trim()
      .toLowerCase();
    if (answer === '1' || answer === 'default') return options.defaultDirectory;
    if (answer === '2' || answer === 'repositorio' || answer === 'repository') {
      return options.repositoryArtifactsDirectory;
    }
    if (answer === '3' || answer === 'personalizada' || answer === 'custom') {
      const customDirectory = (await readline.question('Ruta de salida\n> ')).trim();
      if (customDirectory) {
        return customDirectory === '~'
          ? homedir()
          : customDirectory.startsWith('~/')
            ? resolve(homedir(), customDirectory.slice(2))
            : resolve(customDirectory);
      }
    }
  }
}
