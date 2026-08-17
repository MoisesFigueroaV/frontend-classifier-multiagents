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
import { buildRepositoryIndex, contextMetrics, selectEvidence } from '../lib/evidence-routing';
import { aiProvider } from '../lib/model-provider';
import { recordTokenUsage } from '../lib/token-usage';

import { extractColorThemeTool } from '../tools/extract-color-theme-tool';
import { extractTypographyTool } from '../tools/extract-typography-tool';
import { repositoryInspectorTool } from '../tools/repository-inspector-tool';

const repositoryFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const MAX_FILE_CONTENT_CHARS = 8_000;
const MAX_ANALYSIS_CONTEXT_CHARS = 24_000;
const SPECIALIST_MAX_OUTPUT_TOKENS = 4_000;
const CLASSIFICATION_MAX_OUTPUT_TOKENS = 6_000;

const deepSeekThinkingDisabled =
  aiProvider === 'deepseek'
    ? ({ deepseek: { thinking: { type: 'disabled' } } } as const)
    : undefined;
const deepSeekThinkingEnabled =
  aiProvider === 'deepseek'
    ? ({ deepseek: { thinking: { type: 'enabled' } } } as const)
    : undefined;

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
  for (const path of projectContext.relevantFiles.frontend) priorities.set(path, 4);
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

const repositoryIndexSchema = z.object({
  projectContext: projectContextSchema,
  pages: z.array(z.string()),
  layouts: z.array(z.string()),
  components: z.array(z.string()),
  styles: z.array(z.string()),
  themes: z.array(z.string()),
  tokens: z.array(z.string()),
  animations: z.array(z.string()),
  assets: z.array(z.string()),
});

const inspectedRepositorySchema = z.object({
  projectContext: projectContextSchema,
  index: repositoryIndexSchema,
  files: z.array(repositoryFileSchema),
});

export const analysisContextSchema = z.object({
  projectContext: projectContextSchema,
  index: repositoryIndexSchema,
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
    const index = repositoryIndexSchema.parse(
      buildRepositoryIndex(projectContext, inputData.files),
    );

    return {
      projectContext,
      index,
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
      ...projectContext.relevantFiles.frontend,
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
      index: inputData.index,
      files: buildAnalysisFiles(
        prioritizeAnalysisFiles(filesForExtraction, projectContext),
      ),
      typography,
      colors,
    };
  },
});

const specialistAnalysesStep = createStep({
  id: 'specialist-analyses',

  inputSchema: analysisContextSchema,

  outputSchema: parallelAnalysisSchema,

  execute: async ({ inputData, mastra, requestContext }) => {
    const index = inputData.index;
    const visualEvidence = selectEvidence(inputData.files, 'visual');
    const componentEvidence = selectEvidence(inputData.files, 'components');
    const layoutEvidence = selectEvidence(inputData.files, 'layout');
    const motionEvidence = selectEvidence(inputData.files, 'motion');
    const commonOptions = {
      requestContext,
      maxSteps: 1,
      modelSettings: {
        maxOutputTokens: SPECIALIST_MAX_OUTPUT_TOKENS,
      },
      ...(deepSeekThinkingDisabled
        ? { providerOptions: deepSeekThinkingDisabled }
        : {}),
    };

    const promptFor = (specialist: string, evidence: typeof visualEvidence) => {
      const metrics = contextMetrics(evidence);
      console.info(`[frontend-analysis] ${specialist}: ${metrics.files.toString()} files, ${metrics.characters.toString()} chars`);
      return JSON.stringify({ index, projectContext: inputData.projectContext, typography: inputData.typography, colors: inputData.colors, evidence });
    };

    const visualStyleResult = await mastra.getAgent('visualStyleAgent').generate(
      promptFor('visual-style', visualEvidence),
      {
        ...commonOptions,
        structuredOutput: {
          schema: visualStyleAnalysisSchema,
          errorStrategy: 'strict',
          ...(deepSeekThinkingDisabled
            ? { providerOptions: deepSeekThinkingDisabled }
            : {}),
        },
      },
    );
    recordTokenUsage(requestContext, 'visual-style', visualStyleResult);
    if (!visualStyleResult.object) {
      throw new Error('Visual Style Agent returned no structured output');
    }

    const componentResult = await mastra.getAgent('componentAgent').generate(
      promptFor('components', componentEvidence),
      {
        ...commonOptions,
        structuredOutput: {
          schema: componentAnalysisSchema,
          errorStrategy: 'strict',
          ...(deepSeekThinkingDisabled
            ? { providerOptions: deepSeekThinkingDisabled }
            : {}),
        },
      },
    );
    recordTokenUsage(requestContext, 'components', componentResult);
    if (!componentResult.object) {
      throw new Error('Component Agent returned no structured output');
    }

    const layoutResult = await mastra.getAgent('layoutAgent').generate(promptFor('layout', layoutEvidence), {
      ...commonOptions,
      structuredOutput: {
        schema: layoutAnalysisSchema,
        errorStrategy: 'strict',
        ...(deepSeekThinkingDisabled
          ? { providerOptions: deepSeekThinkingDisabled }
          : {}),
      },
    });
    recordTokenUsage(requestContext, 'layout', layoutResult);
    if (!layoutResult.object) {
      throw new Error('Layout Agent returned no structured output');
    }

    const motionResult = await mastra.getAgent('motionAgent').generate(promptFor('motion', motionEvidence), {
      ...commonOptions,
      structuredOutput: {
        schema: motionAnalysisSchema,
        errorStrategy: 'strict',
        ...(deepSeekThinkingDisabled
          ? { providerOptions: deepSeekThinkingDisabled }
          : {}),
      },
    });
    recordTokenUsage(requestContext, 'motion', motionResult);
    if (!motionResult.object) {
      throw new Error('Motion Agent returned no structured output');
    }

    return {
      'visual-style-analysis': visualStyleAnalysisSchema.parse(
        visualStyleResult.object,
      ),
      'component-analysis': componentAnalysisSchema.parse(componentResult.object),
      'layout-analysis': layoutAnalysisSchema.parse(layoutResult.object),
      'motion-analysis': motionAnalysisSchema.parse(motionResult.object),
    };
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
        modelSettings: {
          maxOutputTokens: CLASSIFICATION_MAX_OUTPUT_TOKENS,
        },
        ...(deepSeekThinkingEnabled
          ? { providerOptions: deepSeekThinkingEnabled }
          : {}),
        structuredOutput: {
          schema: frontendClassificationSchema,
          errorStrategy: 'strict',
          ...(deepSeekThinkingEnabled
            ? { providerOptions: deepSeekThinkingEnabled }
            : {}),
        },
      },
    );
    recordTokenUsage(requestContext, 'classification', result);

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
  .then(specialistAnalysesStep)
  .then(classificationStep)
  .commit();
