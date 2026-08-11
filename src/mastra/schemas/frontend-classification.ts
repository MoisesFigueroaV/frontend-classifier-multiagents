// src/mastra/schemas/frontend-classification.ts

import { z } from 'zod';

import { visualStyleAnalysisSchema } from './visual-style';
import { componentAnalysisSchema } from './component-analysis';
import { layoutAnalysisSchema } from './layout-analysis';
import { motionAnalysisSchema } from './motion-analysis';

export const typographyAnalysisSchema = z.object({
  fontFamilies: z.array(z.string().min(1)),

  fontWeights: z.array(z.number()),

  fontSizes: z.array(z.string().min(1)),

  declaredFonts: z.array(
    z.object({
      family: z.string().min(1),
      source: z.string().min(1),
    }),
  ),

  evidence: z.array(
    z.object({
      value: z.string().min(1),
      property: z.string().min(1),
      source: z.string().min(1),
    }),
  ),
});

export const colorThemeAnalysisSchema = z.object({
  colors: z.array(
    z.object({
      value: z.string().min(1),
      count: z.number().int().positive(),
      sources: z.array(z.string().min(1)),
    }),
  ),

  cssVariables: z.array(
    z.object({
      name: z.string().min(1),
      value: z.string().min(1),
      source: z.string().min(1),
    }),
  ),

  gradients: z.array(
    z.object({
      value: z.string().min(1),
      source: z.string().min(1),
    }),
  ),

  evidence: z.array(
    z.object({
      value: z.string().min(1),
      property: z.string().min(1),
      source: z.string().min(1),
    }),
  ),
});

export const frontendClassificationSchema = z.object({
  project: z.object({
    name: z.string().min(1),

    isFrontend: z.boolean(),

    framework: z.string().min(1),

    language: z.string().min(1),

    uiLibraries: z.array(z.string().min(1)),

    stylingLibraries: z.array(z.string().min(1)),

    motionLibraries: z.array(z.string().min(1)),
  }),

  visualStyle: visualStyleAnalysisSchema,

  components: componentAnalysisSchema,

  layout: layoutAnalysisSchema,

  motion: motionAnalysisSchema,

  typography: typographyAnalysisSchema,

  colors: colorThemeAnalysisSchema,

  overallSummary: z.string().min(1),

  generatedAt: z.string().datetime(),
});

export type TypographyAnalysis = z.infer<
  typeof typographyAnalysisSchema
>;

export type ColorThemeAnalysis = z.infer<
  typeof colorThemeAnalysisSchema
>;

export type FrontendClassification = z.infer<
  typeof frontendClassificationSchema
>;
