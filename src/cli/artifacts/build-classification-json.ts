import type { ArtifactBuilder } from './artifact-types';

export const buildClassificationJson: ArtifactBuilder = (classification) => ({
  fileName: 'classification.json',
  content: `${JSON.stringify(classification, null, 2)}\n`,
});
