import { z } from 'zod';

export const visualStyleEvidenceSchema = z.object({
  observation: z.string().min(1),

  sources: z.array(z.string().min(1)).min(1),
});

export const visualStyleAnalysisSchema = z.object({
  primaryStyle: z.string().min(1),

  secondaryStyles: z.array(z.string().min(1)),

  formality: z.enum(['low', 'medium', 'high']),

  personality: z.array(z.string().min(1)),

  visualDensity: z.enum(['low', 'medium', 'high']),

  complexity: z.enum(['simple', 'moderate', 'complex']),

  consistency: z.enum(['low', 'medium', 'high']),

  evidence: z.array(visualStyleEvidenceSchema).min(1),

  reasoningSummary: z.string().min(1),
});

export type VisualStyleEvidence = z.infer<
  typeof visualStyleEvidenceSchema
>;

export type VisualStyleAnalysis = z.infer<
  typeof visualStyleAnalysisSchema
>;
