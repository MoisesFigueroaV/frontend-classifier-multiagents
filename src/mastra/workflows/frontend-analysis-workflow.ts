import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { projectContextSchema } from '../schemas/project-context';
import {
  typographyAnalysisSchema,
  colorThemeAnalysisSchema,
  frontendClassificationSchema,
} from '../schemas/frontend-classification';
import { classificationSynthesisSchema } from '../schemas/classification-synthesis';
import { visualStyleAnalysisSchema } from '../schemas/visual-style';
import { componentAnalysisSchema } from '../schemas/component-analysis';
import { layoutAnalysisSchema } from '../schemas/layout-analysis';
import { motionAnalysisSchema } from '../schemas/motion-analysis';
import { buildRepositoryIndex, contextMetrics, selectEvidence } from '../lib/evidence-routing';
import { aiProvider } from '../lib/model-provider';
import {
  buildComponentSpecialistPrompt,
  buildLayoutSpecialistPrompt,
  buildMotionSpecialistPrompt,
  buildVisualSpecialistPrompt,
  getVisualPayloadBreakdown,
} from '../lib/specialist-prompts';
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

type StructuredOutputFailure = {
  details?: { value?: unknown };
  cause?: { issues?: Array<{ path?: Array<string | number>; message?: string }> };
  message?: string;
};

function readInvalidStructuredObject(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;

  const details = (error as StructuredOutputFailure).details;
  if (typeof details?.value !== 'string') return undefined;

  try {
    const value = JSON.parse(details.value);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readStructuredOutputIssues(error: unknown) {
  if (!error || typeof error !== 'object') return [];

  const cause = (error as StructuredOutputFailure).cause;
  if (Array.isArray(cause?.issues)) {
    return cause.issues.map((issue) => ({
      path: issue.path?.join('.') || 'root',
      message: issue.message ?? 'Invalid value.',
    }));
  }

  const message = (error as StructuredOutputFailure).message;
  return message ? [{ path: 'root', message }] : [];
}

function buildStructuredOutputRepairPrompt(
  agentName: string,
  invalidObject: Record<string, unknown>,
  issues: Array<{ path: string; message: string }>,
) {
  return JSON.stringify({
    task: 'Repair a previously generated structured object.',
    instructions: [
      `Return only one corrected JSON object for ${agentName}.`,
      'Preserve valid fields from invalidObject.',
      'Fix every validation issue listed below.',
      'Do not add prose outside the structured object.',
      'Do not request or assume repository files; use only invalidObject and validationErrors.',
    ],
    invalidObject,
    validationErrors: issues,
  });
}

function safeStructuredObjectLog(value: Record<string, unknown>) {
  const serialized = JSON.stringify(value);
  const maxCharacters = 4_000;

  return serialized.length <= maxCharacters
    ? serialized
    : `${serialized.slice(0, maxCharacters)}…[truncated]`;
}

async function generateWithSingleStructuredRepair<TResult>(
  agentName: string,
  generate: (prompt: string) => Promise<TResult>,
  prompt: string,
) {
  try {
    return await generate(prompt);
  } catch (error: unknown) {
    const invalidObject = readInvalidStructuredObject(error);
    const issues = readStructuredOutputIssues(error);

    if (!invalidObject) throw error;

    console.warn(
      `[frontend-analysis] ${agentName}: structured output invalid; fields received: ${Object.keys(invalidObject).join(', ') || '(none)'}; issues: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join(' | ')}`,
    );
    console.warn(
      `[frontend-analysis] ${agentName}: invalid structured object: ${safeStructuredObjectLog(invalidObject)}`,
    );
    console.info(`[frontend-analysis] ${agentName}: attempting one structured output repair`);

    return generate(
      buildStructuredOutputRepairPrompt(agentName, invalidObject, issues),
    );
  }
}

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

function buildCompactDesignSignals(
  typography: z.infer<typeof typographyAnalysisSchema>,
  colors: z.infer<typeof colorThemeAnalysisSchema>,
) {
  return {
    typography: {
      fontFamilies: typography.fontFamilies,
      fontWeights: typography.fontWeights,
      fontSizes: typography.fontSizes,
    },
    theme: {
      dominantColors: colors.colors.slice(0, 12).map((color) => ({
        value: color.value,
        count: color.count,
      })),
      gradientSourceCount: new Set(
        colors.gradients.map((gradient) => gradient.source),
      ).size,
    },
  };
}

function assembleFrontendClassification(
  projectContext: z.infer<typeof projectContextSchema>,
  analyses: z.infer<typeof parallelAnalysisSchema>,
  typography: z.infer<typeof typographyAnalysisSchema>,
  colors: z.infer<typeof colorThemeAnalysisSchema>,
  synthesis: z.infer<typeof classificationSynthesisSchema>,
) {
  return frontendClassificationSchema.parse({
    project: {
      ...projectContext.project,
      uiLibraries: projectContext.libraries.ui,
      stylingLibraries: projectContext.libraries.styling,
      motionLibraries: projectContext.libraries.motion,
    },
    visualStyle: analyses['visual-style-analysis'],
    components: analyses['component-analysis'],
    layout: analyses['layout-analysis'],
    motion: analyses['motion-analysis'],
    typography,
    colors,
    overallSummary: synthesis.overallSummary,
    generatedAt: new Date().toISOString(),
  });
}

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

    const logPromptMetrics = (specialist: string, evidence: typeof visualEvidence, prompt: string) => {
      const metrics = contextMetrics(evidence);
      console.info(
        `[frontend-analysis] ${specialist}: selected evidence ${metrics.files.toString()} files / ${metrics.characters.toString()} chars / actual serialized prompt ${prompt.length.toString()} chars`,
      );
    };

    const visualPrompt = buildVisualSpecialistPrompt({
      projectContext: inputData.projectContext,
      typography: inputData.typography,
      colors: inputData.colors,
      evidence: visualEvidence,
    });
    const visualPayloadBreakdown = getVisualPayloadBreakdown({
      projectContext: inputData.projectContext,
      typography: inputData.typography,
      colors: inputData.colors,
      evidence: visualEvidence,
    });
    const componentPrompt = buildComponentSpecialistPrompt({
      projectContext: inputData.projectContext,
      evidence: componentEvidence,
    });
    const layoutPrompt = buildLayoutSpecialistPrompt({
      projectContext: inputData.projectContext,
      evidence: layoutEvidence,
    });
    const motionPrompt = buildMotionSpecialistPrompt({
      projectContext: inputData.projectContext,
      evidence: motionEvidence,
    });

    logPromptMetrics('visual-style', visualEvidence, visualPrompt);
    logPromptMetrics('components', componentEvidence, componentPrompt);
    logPromptMetrics('layout', layoutEvidence, layoutPrompt);
    logPromptMetrics('motion', motionEvidence, motionPrompt);
    console.info(
      `[frontend-analysis] visual payload breakdown:\n- project metadata: ${visualPayloadBreakdown.projectMetadata.toString()} chars\n- typography: ${visualPayloadBreakdown.typography.toString()} chars\n- colors: ${visualPayloadBreakdown.colors.toString()} chars\n- cssVariables: ${visualPayloadBreakdown.cssVariables.toString()} chars\n- gradients: ${visualPayloadBreakdown.gradients.toString()} chars\n- color evidence: ${visualPayloadBreakdown.colorEvidence.toString()} chars\n- selected visual files: ${visualPayloadBreakdown.selectedVisualFiles.toString()} chars\n- JSON structure: ${visualPayloadBreakdown.structuralJsonOverhead.toString()} chars\n- total serialized prompt: ${visualPayloadBreakdown.totalSerializedPrompt.toString()} chars`,
    );

    const visualStyleResult = await generateWithSingleStructuredRepair(
      'visual-style',
      (prompt) =>
        mastra.getAgent('visualStyleAgent').generate(prompt, {
          ...commonOptions,
          structuredOutput: {
            schema: visualStyleAnalysisSchema,
            errorStrategy: 'strict',
            ...(deepSeekThinkingDisabled
              ? { providerOptions: deepSeekThinkingDisabled }
              : {}),
          },
        }),
      visualPrompt,
    );
    recordTokenUsage(requestContext, 'visual-style', visualStyleResult);
    if (!visualStyleResult.object) {
      throw new Error('Visual Style Agent returned no structured output');
    }

    const componentResult = await generateWithSingleStructuredRepair(
      'components',
      (prompt) =>
        mastra.getAgent('componentAgent').generate(prompt, {
          ...commonOptions,
          structuredOutput: {
            schema: componentAnalysisSchema,
            errorStrategy: 'strict',
            ...(deepSeekThinkingDisabled
              ? { providerOptions: deepSeekThinkingDisabled }
              : {}),
          },
        }),
      componentPrompt,
    );
    recordTokenUsage(requestContext, 'components', componentResult);
    if (!componentResult.object) {
      throw new Error('Component Agent returned no structured output');
    }

    const layoutResult = await generateWithSingleStructuredRepair(
      'layout',
      (prompt) =>
        mastra.getAgent('layoutAgent').generate(prompt, {
          ...commonOptions,
          structuredOutput: {
            schema: layoutAnalysisSchema,
            errorStrategy: 'strict',
            ...(deepSeekThinkingDisabled
              ? { providerOptions: deepSeekThinkingDisabled }
              : {}),
          },
        }),
      layoutPrompt,
    );
    recordTokenUsage(requestContext, 'layout', layoutResult);
    if (!layoutResult.object) {
      throw new Error('Layout Agent returned no structured output');
    }

    const motionResult = await generateWithSingleStructuredRepair(
      'motion',
      (prompt) =>
        mastra.getAgent('motionAgent').generate(prompt, {
          ...commonOptions,
          structuredOutput: {
            schema: motionAnalysisSchema,
            errorStrategy: 'strict',
            ...(deepSeekThinkingDisabled
              ? { providerOptions: deepSeekThinkingDisabled }
              : {}),
          },
        }),
      motionPrompt,
    );
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
    const projectMetadata = {
      ...analysisContext.projectContext.project,
      libraries: analysisContext.projectContext.libraries,
    };
    const compactTypographyTheme = buildCompactDesignSignals(
      analysisContext.typography,
      analysisContext.colors,
    );
    const classificationPayload = {
      project: projectMetadata,
      visualStyle: inputData['visual-style-analysis'],
      components: inputData['component-analysis'],
      layout: inputData['layout-analysis'],
      motion: inputData['motion-analysis'],
      typographyTheme: compactTypographyTheme,
    };
    const classificationPrompt = JSON.stringify(classificationPayload);
    console.info(
      `[frontend-analysis] classification payload breakdown:\n- project metadata: ${JSON.stringify(projectMetadata).length.toString()} chars\n- visual analysis: ${JSON.stringify(classificationPayload.visualStyle).length.toString()} chars\n- component analysis: ${JSON.stringify(classificationPayload.components).length.toString()} chars\n- layout analysis: ${JSON.stringify(classificationPayload.layout).length.toString()} chars\n- motion analysis: ${JSON.stringify(classificationPayload.motion).length.toString()} chars\n- compact typography/theme: ${JSON.stringify(compactTypographyTheme).length.toString()} chars\n- total prompt: ${classificationPrompt.length.toString()} chars`,
    );

    const synthesisResult = await generateWithSingleStructuredRepair(
      'classification',
      (prompt) =>
        agent.generate(prompt, {
          requestContext,
          maxSteps: 1,
          modelSettings: {
            maxOutputTokens: CLASSIFICATION_MAX_OUTPUT_TOKENS,
          },
          ...(deepSeekThinkingEnabled
            ? { providerOptions: deepSeekThinkingEnabled }
            : {}),
          structuredOutput: {
            schema: classificationSynthesisSchema,
            errorStrategy: 'strict',
            ...(deepSeekThinkingEnabled
              ? { providerOptions: deepSeekThinkingEnabled }
              : {}),
          },
      }),
      classificationPrompt,
    );
    recordTokenUsage(requestContext, 'classification', synthesisResult);

    if (!synthesisResult.object) {
      throw new Error(
        'Classification Agent returned no structured synthesis output',
      );
    }

    return assembleFrontendClassification(
      analysisContext.projectContext,
      inputData,
      analysisContext.typography,
      analysisContext.colors,
      classificationSynthesisSchema.parse(synthesisResult.object),
    );
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
