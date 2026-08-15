import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { projectContextSchema } from '../schemas/project-context';
import {
  typographyAnalysisSchema,
  colorThemeAnalysisSchema,
  frontendClassificationSchema,
} from '../schemas/frontend-classification';
import { visualStyleAnalysisSchema } from '../schemas/visual-style';
import { componentAnalysisSchema } from '../schemas/component-analysis';
import { layoutAnalysisSchema } from '../schemas/layout-analysis';
import { motionAnalysisSchema } from '../schemas/motion-analysis';

import { extractColorThemeTool } from '../tools/extract-color-theme-tool';
import { extractTypographyTool } from '../tools/extract-typography-tool';
import { repositoryInspectorTool } from '../tools/repository-inspector-tool';

const repositoryFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const MAX_FILE_CONTENT_CHARS = 8_000;
const MAX_ANALYSIS_CONTEXT_CHARS = 24_000;

const toolObserve = {
  span: async <T>(
    _name: string,
    operation: () => Promise<T> | T,
  ) => operation(),
  log: (
    _level: 'debug' | 'info' | 'warn' | 'error' | 'fatal',
    _message: string,
    _data?: Record<string, unknown>,
  ) => undefined,
};

function buildAnalysisFiles(
  files: Array<{ path: string; content: string }>,
) {
  let remaining = MAX_ANALYSIS_CONTEXT_CHARS;

  return files.flatMap((file) => {
    if (remaining <= 0) return [];

    const content = file.content.slice(
      0,
      Math.min(MAX_FILE_CONTENT_CHARS, remaining),
    );
    remaining -= content.length;

    return [{ path: file.path, content }];
  });
}

function prioritizeAnalysisFiles(
  files: Array<{ path: string; content: string }>,
  projectContext: z.infer<typeof projectContextSchema>,
) {
  const priorities = new Map<string, number>();
  for (const path of projectContext.relevantFiles.components) priorities.set(path, 3);
  for (const path of projectContext.relevantFiles.pages) priorities.set(path, 2);
  for (const path of projectContext.relevantFiles.styles) priorities.set(path, 1);
  for (const path of projectContext.relevantFiles.themes) priorities.set(path, 0);

  return [...files].sort(
    (left, right) =>
      (priorities.get(left.path) ?? 4) - (priorities.get(right.path) ?? 4) ||
      left.path.localeCompare(right.path),
  );
}

export const repositoryInputSchema = z.object({
  projectName: z.string().min(1),
  files: z.array(repositoryFileSchema),
});

const inspectedRepositorySchema = z.object({
  projectContext: projectContextSchema,
  files: z.array(repositoryFileSchema),
});

export const analysisContextSchema = z.object({
  projectContext: projectContextSchema,
  files: z.array(repositoryFileSchema),
  typography: typographyAnalysisSchema,
  colors: colorThemeAnalysisSchema,
});

const parallelAnalysisSchema = z.object({
  'visual-style-analysis': visualStyleAnalysisSchema,
  'component-analysis': componentAnalysisSchema,
  'layout-analysis': layoutAnalysisSchema,
  'motion-analysis': motionAnalysisSchema,
});

const inspectRepositoryStep = createStep({
  id: 'inspect-repository',

  inputSchema: repositoryInputSchema,

  outputSchema: inspectedRepositorySchema,

  execute: async ({ inputData, requestContext }) => {
    const result = await repositoryInspectorTool.execute!(
      {
        projectName: inputData.projectName,
        files: inputData.files,
      },
      { requestContext, observe: toolObserve },
    );
    const projectContext = projectContextSchema.parse(result);

    return {
      projectContext,
      files: inputData.files,
    };
  },
});

const extractDesignDataStep = createStep({
  id: 'extract-design-data',

  inputSchema: inspectedRepositorySchema,

  outputSchema: analysisContextSchema,

  execute: async ({ inputData, requestContext }) => {
    const { projectContext, files } = inputData;

    const relevantPaths = new Set([
      ...projectContext.relevantFiles.styles,
      ...projectContext.relevantFiles.themes,
      ...projectContext.relevantFiles.components,
      ...projectContext.relevantFiles.pages,
    ]);

    const relevantFiles = files.filter((file) =>
      relevantPaths.has(file.path),
    );

    const filesForExtraction =
      relevantFiles.length > 0 ? relevantFiles : files;

    const [typographyResult, colorsResult] = await Promise.all([
      extractTypographyTool.execute!(
        { files: filesForExtraction },
        { requestContext, observe: toolObserve },
      ),
      extractColorThemeTool.execute!(
        { files: filesForExtraction },
        { requestContext, observe: toolObserve },
      ),
    ]);
    const typography = typographyAnalysisSchema.parse(typographyResult);
    const colors = colorThemeAnalysisSchema.parse(colorsResult);

    return {
      projectContext,
      files: buildAnalysisFiles(
        prioritizeAnalysisFiles(filesForExtraction, projectContext),
      ),
      typography,
      colors,
    };
  },
});

const visualStyleStep = createStep({
  id: 'visual-style-analysis',

  inputSchema: analysisContextSchema,

  outputSchema: visualStyleAnalysisSchema,

  execute: async ({
    inputData,
    mastra,
    requestContext,
  }) => {
    const agent = mastra.getAgent('visualStyleAgent');

    const result = await agent.generate(
      JSON.stringify(inputData),
      {
        requestContext,
        maxSteps: 1,
        structuredOutput: {
          schema: visualStyleAnalysisSchema,
          errorStrategy: 'strict',
        },
      },
    );

    if (!result.object) {
      throw new Error(
        'Visual Style Agent returned no structured output',
      );
    }

    return result.object;
  },
});

const componentStep = createStep({
  id: 'component-analysis',

  inputSchema: analysisContextSchema,

  outputSchema: componentAnalysisSchema,

  execute: async ({
    inputData,
    mastra,
    requestContext,
  }) => {
    const agent = mastra.getAgent('componentAgent');

    const result = await agent.generate(
      JSON.stringify(inputData),
      {
        requestContext,
        maxSteps: 1,
        structuredOutput: {
          schema: componentAnalysisSchema,
          errorStrategy: 'strict',
        },
      },
    );

    if (!result.object) {
      throw new Error(
        'Component Agent returned no structured output',
      );
    }

    return result.object;
  },
});

const layoutStep = createStep({
  id: 'layout-analysis',

  inputSchema: analysisContextSchema,

  outputSchema: layoutAnalysisSchema,

  execute: async ({
    inputData,
    mastra,
    requestContext,
  }) => {
    const agent = mastra.getAgent('layoutAgent');

    const result = await agent.generate(
      JSON.stringify(inputData),
      {
        requestContext,
        maxSteps: 1,
        structuredOutput: {
          schema: layoutAnalysisSchema,
          errorStrategy: 'strict',
        },
      },
    );

    if (!result.object) {
      throw new Error(
        'Layout Agent returned no structured output',
      );
    }

    return result.object;
  },
});

const motionStep = createStep({
  id: 'motion-analysis',

  inputSchema: analysisContextSchema,

  outputSchema: motionAnalysisSchema,

  execute: async ({
    inputData,
    mastra,
    requestContext,
  }) => {
    const agent = mastra.getAgent('motionAgent');

    const result = await agent.generate(
      JSON.stringify(inputData),
      {
        requestContext,
        maxSteps: 1,
        structuredOutput: {
          schema: motionAnalysisSchema,
          errorStrategy: 'strict',
        },
      },
    );

    if (!result.object) {
      throw new Error(
        'Motion Agent returned no structured output',
      );
    }

    return result.object;
  },
});

const classificationStep = createStep({
  id: 'classify-frontend',

  inputSchema: parallelAnalysisSchema,

  outputSchema: frontendClassificationSchema,

  execute: async ({
    inputData,
    mastra,
    requestContext,
    getStepResult,
  }) => {
    const analysisContext =
      getStepResult(extractDesignDataStep);

    if (!analysisContext) {
      throw new Error(
        'Analysis context is missing',
      );
    }

    const agent = mastra.getAgent('classificationAgent');

    const result = await agent.generate(
      JSON.stringify({
        projectContext: analysisContext.projectContext,
        typography: analysisContext.typography,
        colors: analysisContext.colors,
        visualStyle:
          inputData['visual-style-analysis'],
        components:
          inputData['component-analysis'],
        layout:
          inputData['layout-analysis'],
        motion:
          inputData['motion-analysis'],
      }),
      {
        requestContext,
        maxSteps: 1,
        structuredOutput: {
          schema: frontendClassificationSchema,
          errorStrategy: 'strict',
        },
      },
    );

    if (!result.object) {
      throw new Error(
        'Classification Agent returned no structured output',
      );
    }

    return result.object;
  },
});

export const frontendAnalysisWorkflow = createWorkflow({
  id: 'frontend-analysis-workflow',

  inputSchema: repositoryInputSchema,

  outputSchema: frontendClassificationSchema,
})
  .then(inspectRepositoryStep)
  .then(extractDesignDataStep)
  .parallel([
    visualStyleStep,
    componentStep,
    layoutStep,
    motionStep,
  ])
  .then(classificationStep)
  .commit();
