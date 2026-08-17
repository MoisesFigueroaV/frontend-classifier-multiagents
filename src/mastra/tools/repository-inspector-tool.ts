// src/mastra/tools/repository-inspector-tool.ts

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { projectContextSchema } from '../schemas/project-context';

const repositoryFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const FRONTEND_FILE_PATTERN =
  /\.(?:astro|css|html|jsx|less|sass|scss|svelte|tsx|vue)$|\.(?:ts|js|mjs|cjs)$/i;
const FRONTEND_DEPENDENCIES = new Set([
  '@angular/core',
  '@remix-run/react',
  '@solidjs/router',
  'astro',
  'next',
  'react',
  'solid-js',
  'svelte',
  'vue',
]);
const NON_UI_PACKAGE_DIRECTORY_PATTERN =
  /(?:^|\/)(?:api|backend|database|email|notifications?|server)(?:\/|$)/i;

type PackageInfo = {
  directory: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

function isFrontendPackage(packageInfo: PackageInfo) {
  if (NON_UI_PACKAGE_DIRECTORY_PATTERN.test(packageInfo.directory)) {
    return false;
  }

  const dependencies = {
    ...packageInfo.dependencies,
    ...packageInfo.devDependencies,
  };

  return Object.keys(dependencies).some((dependency) =>
    FRONTEND_DEPENDENCIES.has(dependency),
  );
}

function isWithinPackage(
  path: string,
  directory: string,
  packageDirectories: string[],
) {
  if (directory.length > 0) return path.startsWith(directory);

  return !packageDirectories.some(
    (nestedDirectory) =>
      nestedDirectory.length > 0 && path.startsWith(nestedDirectory),
  );
}

export const repositoryInspectorTool = createTool({
  id: 'repository-inspector',

  description:
    'Inspects a repository snapshot and detects frontend technology, relevant libraries, structure, and files for later frontend analysis.',

  inputSchema: z.object({
    projectName: z.string().min(1),
    files: z.array(repositoryFileSchema),
  }),

  outputSchema: projectContextSchema,

  execute: async ({ projectName, files }) => {
    const filePaths = files.map((file) => file.path);
    const packageJsonFiles = files.filter((file) =>
      file.path.endsWith('package.json'),
    );

    const packageInfos: PackageInfo[] = [];

    for (const packageJsonFile of packageJsonFiles) {
      try {
        const packageJson = JSON.parse(packageJsonFile.content);

        packageInfos.push({
          directory: packageJsonFile.path.slice(0, -'package.json'.length),
          dependencies: packageJson.dependencies ?? {},
          devDependencies: packageJson.devDependencies ?? {},
        });
      } catch {
        // Ignoramos package.json no válidos.
      }
    }

    const frontendPackages = packageInfos.filter(isFrontendPackage);
    const frontendFiles = filePaths.filter(
      (path) =>
        FRONTEND_FILE_PATTERN.test(path) &&
        frontendPackages.some((packageInfo) =>
          isWithinPackage(
            path,
            packageInfo.directory,
            packageInfos.map((candidate) => candidate.directory),
          ),
        ),
    );

    const selectedPackages =
      frontendPackages.length > 0
        ? frontendPackages
        : packageInfos.filter((packageInfo) => packageInfo.directory.length === 0);

    const dependencies = Object.assign(
      {},
      ...selectedPackages.map((packageInfo) => packageInfo.dependencies),
    ) as Record<string, string>;
    const devDependencies = Object.assign(
      {},
      ...selectedPackages.map((packageInfo) => packageInfo.devDependencies),
    ) as Record<string, string>;

    const allDependencies = {
      ...dependencies,
      ...devDependencies,
    };

    let framework = 'unknown';

    if ('next' in allDependencies) {
      framework = 'Next.js';
    } else if ('@angular/core' in allDependencies) {
      framework = 'Angular';
    } else if ('vue' in allDependencies) {
      framework = 'Vue';
    } else if ('svelte' in allDependencies) {
      framework = 'Svelte';
    } else if ('react' in allDependencies) {
      framework = 'React';
    }

    const hasTypeScript = files.some(
      (file) =>
        file.path.endsWith('.ts') ||
        file.path.endsWith('.tsx'),
    );

    const hasJavaScript = files.some(
      (file) =>
        file.path.endsWith('.js') ||
        file.path.endsWith('.jsx'),
    );

    const language = hasTypeScript
      ? 'TypeScript'
      : hasJavaScript
        ? 'JavaScript'
        : 'unknown';

    const uiLibraries = Object.keys(allDependencies).filter((name) =>
      [
        '@radix-ui/',
        '@mui/',
        '@chakra-ui/',
        'antd',
        '@headlessui/',
        'shadcn',
      ].some((prefix) => name.startsWith(prefix)),
    );

    const stylingLibraries = Object.keys(allDependencies).filter(
      (name) =>
        [
          'tailwindcss',
          'styled-components',
          '@emotion/react',
          '@emotion/styled',
          'sass',
          'less',
        ].includes(name),
    );

    const motionLibraries = Object.keys(allDependencies).filter(
      (name) =>
        [
          'framer-motion',
          'motion',
          'gsap',
          '@react-spring/web',
        ].includes(name),
    );

    const componentFiles = frontendFiles.filter(
      (path) =>
        /components?/i.test(path) &&
        /\.(tsx|jsx|vue|svelte)$/.test(path),
    );

    const pageFiles = frontendFiles.filter(
      (path) =>
        /(pages?|app|routes?)/i.test(path) &&
        /\.(tsx|jsx|vue|svelte)$/.test(path),
    );

    const styleFiles = frontendFiles.filter((path) =>
      /\.(css|scss|sass|less)$/.test(path),
    );

    const themeFiles = frontendFiles.filter((path) =>
      /(theme|tokens?|variables)/i.test(path),
    );

    const uniqueDirectories = (paths: string[]) => [
      ...new Set(
        paths.map((path) => {
          const parts = path.split('/');
          parts.pop();

          return parts.join('/');
        }),
      ),
    ].filter(Boolean);

    return {
      project: {
        name: projectName,
        isFrontend:
          framework !== 'unknown' ||
          componentFiles.length > 0 ||
          pageFiles.length > 0,
        framework,
        language,
      },

      libraries: {
        ui: uiLibraries,
        styling: stylingLibraries,
        motion: motionLibraries,
      },

      structure: {
        componentDirectories:
          uniqueDirectories(componentFiles),
        pageDirectories:
          uniqueDirectories(pageFiles),
        styleDirectories:
          uniqueDirectories(styleFiles),
        themeFiles,
      },

      relevantFiles: {
        frontend: frontendFiles,
        components: componentFiles,
        pages: pageFiles,
        styles: styleFiles,
        themes: themeFiles,
      },
    };
  },
});
