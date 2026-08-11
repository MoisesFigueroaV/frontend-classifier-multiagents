// src/mastra/tools/repository-inspector-tool.ts

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { projectContextSchema } from '../schemas/project-context';

const repositoryFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

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
    const packageJsonFile = files.find(
      (file) => file.path === 'package.json',
    );

    let dependencies: Record<string, string> = {};
    let devDependencies: Record<string, string> = {};

    if (packageJsonFile) {
      try {
        const packageJson = JSON.parse(packageJsonFile.content);

        dependencies = packageJson.dependencies ?? {};
        devDependencies = packageJson.devDependencies ?? {};
      } catch {
        // Dejamos las dependencias vacías si package.json no es válido.
      }
    }

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

    const filePaths = files.map((file) => file.path);

    const componentFiles = filePaths.filter(
      (path) =>
        /components?/i.test(path) &&
        /\.(tsx|jsx|vue|svelte)$/.test(path),
    );

    const pageFiles = filePaths.filter(
      (path) =>
        /(pages?|app|routes?)/i.test(path) &&
        /\.(tsx|jsx|vue|svelte)$/.test(path),
    );

    const styleFiles = filePaths.filter((path) =>
      /\.(css|scss|sass|less)$/.test(path),
    );

    const themeFiles = filePaths.filter((path) =>
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
        components: componentFiles,
        pages: pageFiles,
        styles: styleFiles,
        themes: themeFiles,
      },
    };
  },
});
