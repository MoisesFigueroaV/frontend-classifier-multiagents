import { z } from 'zod';

export const classificationSynthesisSchema = z.object({
  overallSummary: z.string().min(1),
  designIdentity: z.string().min(1),
  dominantCharacteristics: z.array(z.string().min(1)),
  designPrinciples: z.array(z.string().min(1)),
  crossCuttingPatterns: z.array(z.string().min(1)),
});

export type ClassificationSynthesis = z.infer<
  typeof classificationSynthesisSchema
>;
