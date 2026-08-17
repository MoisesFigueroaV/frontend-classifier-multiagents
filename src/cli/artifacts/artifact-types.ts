import type { FrontendClassification } from '../../mastra/schemas/frontend-classification';

export const artifactFileNames = {
  classification: 'classification.json',
  uiSkill: 'UI_SKILL.md',
  designReport: 'design-report.md',
} as const;

export type ArtifactKind = keyof typeof artifactFileNames;

export type ArtifactFile = {
  fileName: string;
  content: string;
};

export type ArtifactBuilder = (
  classification: FrontendClassification,
) => ArtifactFile;
