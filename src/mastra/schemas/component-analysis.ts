// src/mastra/schemas/component-analysis.ts

import { z } from 'zod';

export const componentEvidenceSchema = z.object({
  observation: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
});

export const componentPatternSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

export const componentAnalysisSchema = z.object({
  componentFamilies: z.array(z.string().min(1)),

  shapeLanguage: z.object({
    dominantRadius: z.enum([
      'none',
      'small',
      'medium',
      'large',
      'pill',
      'mixed',
    ]),

    commonShapes: z.array(z.string().min(1)),
  }),

  borders: z.object({
    usage: z.enum(['none', 'low', 'medium', 'high']),
    styles: z.array(z.string().min(1)),
  }),

  shadows: z.object({
    usage: z.enum(['none', 'low', 'medium', 'high']),
    styles: z.array(z.string().min(1)),
  }),

  variants: z.array(z.string().min(1)),

  interactionStates: z.array(z.string().min(1)),

  consistency: z.enum(['low', 'medium', 'high']),

  reuseLevel: z.enum(['low', 'medium', 'high']),

  patterns: z.array(componentPatternSchema),

  evidence: z.array(componentEvidenceSchema).min(1),

  reasoningSummary: z.string().min(1),
});

export type ComponentEvidence = z.infer<
  typeof componentEvidenceSchema
>;

export type ComponentPattern = z.infer<
  typeof componentPatternSchema
>;

export type ComponentAnalysis = z.infer<
  typeof componentAnalysisSchema
>;
