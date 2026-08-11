// src/mastra/schemas/layout-analysis.ts

import { z } from 'zod';

export const layoutEvidenceSchema = z.object({
  observation: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
});

export const layoutPatternSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

export const layoutAnalysisSchema = z.object({
  pageStructure: z.object({
    dominantType: z.enum([
      'single-column',
      'two-column',
      'multi-column',
      'dashboard',
      'grid-based',
      'asymmetric',
      'mixed',
    ]),

    sectionFlow: z.array(z.string().min(1)),
  }),

  contentDensity: z.enum(['low', 'medium', 'high']),

  spacing: z.object({
    overall: z.enum(['tight', 'balanced', 'spacious', 'mixed']),
    consistency: z.enum(['low', 'medium', 'high']),
  }),

  hierarchy: z.object({
    strength: z.enum(['weak', 'medium', 'strong']),
    techniques: z.array(z.string().min(1)),
  }),

  alignment: z.object({
    dominant: z.enum([
      'left',
      'center',
      'right',
      'mixed',
      'grid-aligned',
    ]),

    consistency: z.enum(['low', 'medium', 'high']),
  }),

  navigationPatterns: z.array(z.string().min(1)),

  responsiveBehavior: z.object({
    confidence: z.enum(['low', 'medium', 'high']),
    patterns: z.array(z.string().min(1)),
  }),

  compositionPatterns: z.array(layoutPatternSchema),

  consistency: z.enum(['low', 'medium', 'high']),

  evidence: z.array(layoutEvidenceSchema).min(1),

  reasoningSummary: z.string().min(1),
});

export type LayoutEvidence = z.infer<
  typeof layoutEvidenceSchema
>;

export type LayoutPattern = z.infer<
  typeof layoutPatternSchema
>;

export type LayoutAnalysis = z.infer<
  typeof layoutAnalysisSchema
>;
