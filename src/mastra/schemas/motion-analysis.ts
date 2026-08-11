// src/mastra/schemas/motion-analysis.ts

import { z } from 'zod';

export const motionEvidenceSchema = z.object({
  observation: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
});

export const motionPatternSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

export const motionAnalysisSchema = z.object({
  transitionDurations: z.object({
    commonValues: z.array(z.string().min(1)),
    dominantRange: z.string().min(1),
  }),

  easing: z.object({
    commonValues: z.array(z.string().min(1)),
    dominantStyle: z.string().min(1),
  }),

  hoverEffects: z.array(z.string().min(1)),

  entranceAnimations: z.array(z.string().min(1)),

  exitAnimations: z.array(z.string().min(1)),

  microInteractions: z.array(z.string().min(1)),

  transformPatterns: z.array(z.string().min(1)),

  scrollEffects: z.array(z.string().min(1)),

  motionIntensity: z.enum([
    'none',
    'subtle',
    'moderate',
    'high',
  ]),

  motionStyle: z.array(z.string().min(1)),

  consistency: z.enum([
    'low',
    'medium',
    'high',
  ]),

  patterns: z.array(motionPatternSchema),

  evidence: z.array(motionEvidenceSchema).min(1),

  reasoningSummary: z.string().min(1),
});

export type MotionEvidence = z.infer<
  typeof motionEvidenceSchema
>;

export type MotionPattern = z.infer<
  typeof motionPatternSchema
>;

export type MotionAnalysis = z.infer<
  typeof motionAnalysisSchema
>;
