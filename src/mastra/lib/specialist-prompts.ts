import type { z } from 'zod';

import type { colorThemeAnalysisSchema, typographyAnalysisSchema } from '../schemas/frontend-classification';
import type { projectContextSchema } from '../schemas/project-context';
import type { EvidenceFile } from './evidence-routing';

type ProjectContext = z.infer<typeof projectContextSchema>;
type Typography = z.infer<typeof typographyAnalysisSchema>;
type ColorTheme = z.infer<typeof colorThemeAnalysisSchema>;

function projectMetadata(projectContext: ProjectContext) {
  return {
    name: projectContext.project.name,
    isFrontend: projectContext.project.isFrontend,
    framework: projectContext.project.framework,
    language: projectContext.project.language,
  };
}

function visualColorTheme(colors: ColorTheme) {
  const cssVariables = new Map<
    string,
    { name: string; value: string; sources: Set<string> }
  >();

  for (const variable of colors.cssVariables) {
    const key = `${variable.name}\u0000${variable.value}`;
    const existing = cssVariables.get(key) ?? {
      name: variable.name,
      value: variable.value,
      sources: new Set<string>(),
    };
    existing.sources.add(variable.source);
    cssVariables.set(key, existing);
  }

  return {
    colors: colors.colors,
    cssVariables: [...cssVariables.values()].map((variable) => ({
      name: variable.name,
      value: variable.value,
      sources: [...variable.sources].sort(),
    })),
    // Gradient source references remain available without serializing potentially
    // minified CSS captured by the deterministic extractor. The selected evidence
    // contains the source code used to inspect concrete gradient declarations.
    gradientSources: [...new Set(colors.gradients.map((gradient) => gradient.source))],
  };
}

function buildVisualPayload(input: {
  projectContext: ProjectContext;
  typography: Typography;
  colors: ColorTheme;
  evidence: EvidenceFile[];
}) {
  return {
    project: projectMetadata(input.projectContext),
    typography: input.typography,
    colorTheme: visualColorTheme(input.colors),
    evidence: input.evidence,
  };
}

export type VisualPayloadBreakdown = {
  projectMetadata: number;
  typography: number;
  colors: number;
  cssVariables: number;
  gradients: number;
  colorEvidence: number;
  selectedVisualFiles: number;
  structuralJsonOverhead: number;
  totalSerializedPrompt: number;
};

export function getVisualPayloadBreakdown(input: {
  projectContext: ProjectContext;
  typography: Typography;
  colors: ColorTheme;
  evidence: EvidenceFile[];
}): VisualPayloadBreakdown {
  const payload = buildVisualPayload(input);
  const projectMetadata = JSON.stringify(payload.project).length;
  const typography = JSON.stringify(payload.typography).length;
  const colors = JSON.stringify(payload.colorTheme.colors).length;
  const cssVariables = JSON.stringify(payload.colorTheme.cssVariables).length;
  const gradients = JSON.stringify(payload.colorTheme.gradientSources).length;
  const selectedVisualFiles = JSON.stringify(payload.evidence).length;
  const totalSerializedPrompt = JSON.stringify(payload).length;
  const structuralJsonOverhead =
    totalSerializedPrompt -
    projectMetadata -
    typography -
    colors -
    cssVariables -
    gradients -
    selectedVisualFiles;

  return {
    projectMetadata,
    typography,
    colors,
    cssVariables,
    gradients,
    // Raw deterministic color evidence intentionally does not cross this DTO.
    colorEvidence: 0,
    selectedVisualFiles,
    structuralJsonOverhead,
    totalSerializedPrompt,
  };
}

export function buildVisualSpecialistPrompt(input: {
  projectContext: ProjectContext;
  typography: Typography;
  colors: ColorTheme;
  evidence: EvidenceFile[];
}) {
  return JSON.stringify(buildVisualPayload(input));
}

export function buildComponentSpecialistPrompt(input: {
  projectContext: ProjectContext;
  evidence: EvidenceFile[];
}) {
  return JSON.stringify({
    project: projectMetadata(input.projectContext),
    libraries: {
      ui: input.projectContext.libraries.ui,
      styling: input.projectContext.libraries.styling,
    },
    evidence: input.evidence,
  });
}

export function buildLayoutSpecialistPrompt(input: {
  projectContext: ProjectContext;
  evidence: EvidenceFile[];
}) {
  return JSON.stringify({
    project: projectMetadata(input.projectContext),
    evidence: input.evidence,
  });
}

export function buildMotionSpecialistPrompt(input: {
  projectContext: ProjectContext;
  evidence: EvidenceFile[];
}) {
  return JSON.stringify({
    project: projectMetadata(input.projectContext),
    libraries: {
      motion: input.projectContext.libraries.motion,
    },
    evidence: input.evidence,
  });
}
