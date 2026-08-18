import type { z } from 'zod';

import type { colorThemeAnalysisSchema, typographyAnalysisSchema } from '../schemas/frontend-classification';
import type { projectContextSchema } from '../schemas/project-context';
import type { EvidenceFile } from './evidence-routing';
import type { ComponentGroundingCandidates } from './component-grounding';
import type { MotionGroundingCandidates } from './motion-grounding';

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

function exhaustiveVisualColorTheme(colors: ColorTheme) {
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

type CompactColor = {
  value: string;
  count: number;
  representativeSources: string[];
};

type CompactVariable = {
  name: string;
  value: string;
  representativeSources: string[];
};

const semanticColorNames = [
  'background',
  'foreground',
  'primary',
  'secondary',
  'accent',
  'muted',
  'destructive',
  'border',
  'ring',
] as const;

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

function compactVariable(variable: { name: string; value: string; source: string }): CompactVariable {
  return {
    name: variable.name,
    value: variable.value,
    representativeSources: [variable.source],
  };
}

function isNeutralColor(value: string) {
  const normalized = value.trim().toLowerCase();
  if (['transparent', 'white', 'black', 'currentcolor'].includes(normalized)) return true;
  const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (!hex) return false;
  const expanded = hex.length === 3 ? hex.split('').map((part) => part.repeat(2)).join('') : hex.slice(0, 6);
  return expanded.slice(0, 2) === expanded.slice(2, 4) && expanded.slice(2, 4) === expanded.slice(4, 6);
}

function gradientType(value: string) {
  return value.match(/\b(linear|radial|conic)-gradient\b/i)?.[1]?.toLowerCase() ?? 'other';
}

/**
 * A compact semantic view for the Visual agent. The full extractor result is
 * deliberately retained in FrontendClassification; only this prompt DTO is
 * reduced so repeated source-level observations never cross the LLM boundary.
 */
function compactVisualTheme(colors: ColorTheme) {
  const sortedColors = [...colors.colors].sort(
    (left, right) => right.count - left.count || left.value.localeCompare(right.value),
  );
  const toCompactColor = (color: (typeof colors.colors)[number]): CompactColor => ({
    value: color.value,
    count: color.count,
    representativeSources: uniqueSorted(color.sources).slice(0, 3),
  });

  const semanticColors = Object.fromEntries(
    semanticColorNames.map((semanticName) => {
      const variables = colors.cssVariables
        .filter((variable) => variable.name.toLowerCase().includes(semanticName))
        .sort((left, right) => left.name.localeCompare(right.name) || left.value.localeCompare(right.value));
      return [
        semanticName,
        variables.slice(0, 6).map(compactVariable),
      ];
    }),
  ) as Record<(typeof semanticColorNames)[number], CompactVariable[]>;

  const variableGroups = new Map<string, { name: string; value: string; sources: Set<string> }>();
  for (const variable of colors.cssVariables) {
    const key = `${variable.name}\u0000${variable.value}`;
    const current = variableGroups.get(key) ?? {
      name: variable.name,
      value: variable.value,
      sources: new Set<string>(),
    };
    current.sources.add(variable.source);
    variableGroups.set(key, current);
  }
  const compactVariables = [...variableGroups.values()]
    .map((variable) => ({
      name: variable.name,
      value: variable.value,
      representativeSources: [...variable.sources].sort().slice(0, 3),
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.value.localeCompare(right.value));
  const byName = (expression: RegExp) => compactVariables.filter((variable) => expression.test(variable.name));
  const accountedFor = new Set(
    compactVariables
      .filter((variable) => /(?:background|foreground|primary|secondary|accent|muted|destructive|border|ring|radius|font|type)/i.test(variable.name))
      .map((variable) => `${variable.name}\u0000${variable.value}`),
  );

  const gradientGroups = new Map<string, Set<string>>();
  for (const gradient of colors.gradients) {
    const type = gradientType(gradient.value);
    const sources = gradientGroups.get(type) ?? new Set<string>();
    sources.add(gradient.source);
    gradientGroups.set(type, sources);
  }

  return {
    dominantColors: sortedColors.slice(0, 12).map(toCompactColor),
    semanticColors,
    neutrals: sortedColors.filter((color) => isNeutralColor(color.value)).slice(0, 12).map(toCompactColor),
    darkModeSignals: compactVariables
      .filter((variable) => /dark|night|surface|background|foreground/i.test(variable.name) || variable.representativeSources.some((source) => /dark/i.test(source)))
      .slice(0, 12),
    gradients: {
      types: [...gradientGroups.entries()]
        .map(([type, sources]) => ({ type, count: sources.size }))
        .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type)),
      representativeExamples: [...gradientGroups.entries()]
        .map(([type, sources]) => ({ type, representativeSources: [...sources].sort().slice(0, 3) }))
        .sort((left, right) => left.type.localeCompare(right.type)),
    },
    cssVariables: {
      totalCount: colors.cssVariables.length,
      uniqueNameValueCount: compactVariables.length,
      // Semantic categories above preserve representative values for each theme
      // role; this count retains the scale without repeating every token.
      themeVariableCount: compactVariables.filter((variable) => /(?:background|foreground|primary|secondary|accent|muted|destructive|border|ring)/i.test(variable.name)).length,
      themeVariables: semanticColors,
      radiusVariableCount: byName(/radius/i).length,
      radiusVariables: byName(/radius/i).slice(0, 12),
      typographyVariableCount: byName(/(?:font|type)/i).length,
      typographyVariables: byName(/(?:font|type)/i).slice(0, 12),
      otherVariableCount: compactVariables.filter((variable) => !accountedFor.has(`${variable.name}\u0000${variable.value}`)).length,
    },
  };
}

function compactTypography(typography: Typography) {
  return {
    fontFamilies: typography.fontFamilies,
    fontWeights: typography.fontWeights,
    fontSizes: typography.fontSizes,
    declaredFonts: typography.declaredFonts,
    evidenceCount: typography.evidence.length,
    representativeEvidence: typography.evidence.slice(0, 8),
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
    typography: compactTypography(input.typography),
    theme: compactVisualTheme(input.colors),
    evidence: input.evidence,
  };
}

export type VisualPayloadBreakdown = {
  before: {
    colors: number;
    cssVariables: number;
    typography: number;
    evidence: number;
    total: number;
  };
  after: {
    compactColors: number;
    compactCssVariables: number;
    typography: number;
    evidence: number;
    total: number;
  };
};

export function getVisualPayloadBreakdown(input: {
  projectContext: ProjectContext;
  typography: Typography;
  colors: ColorTheme;
  evidence: EvidenceFile[];
}): VisualPayloadBreakdown {
  const payload = buildVisualPayload(input);
  const beforePayload = {
    project: projectMetadata(input.projectContext),
    typography: input.typography,
    colorTheme: exhaustiveVisualColorTheme(input.colors),
    evidence: input.evidence,
  };

  return {
    before: {
      colors: JSON.stringify(beforePayload.colorTheme.colors).length,
      cssVariables: JSON.stringify(beforePayload.colorTheme.cssVariables).length,
      typography: JSON.stringify(beforePayload.typography).length,
      evidence: JSON.stringify(beforePayload.evidence).length,
      total: JSON.stringify(beforePayload).length,
    },
    after: {
      compactColors: JSON.stringify(payload.theme.dominantColors).length + JSON.stringify(payload.theme.semanticColors).length + JSON.stringify(payload.theme.neutrals).length + JSON.stringify(payload.theme.darkModeSignals).length + JSON.stringify(payload.theme.gradients).length,
      compactCssVariables: JSON.stringify(payload.theme.cssVariables).length,
      typography: JSON.stringify(payload.typography).length,
      evidence: JSON.stringify(payload.evidence).length,
      total: JSON.stringify(payload).length,
    },
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
  groundedCandidates: ComponentGroundingCandidates;
}) {
  return JSON.stringify({
    project: projectMetadata(input.projectContext),
    libraries: {
      ui: input.projectContext.libraries.ui,
      styling: input.projectContext.libraries.styling,
    },
    observedCandidates: input.groundedCandidates,
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
  groundedCandidates: MotionGroundingCandidates;
}) {
  return JSON.stringify({
    project: projectMetadata(input.projectContext),
    libraries: {
      motion: input.projectContext.libraries.motion,
    },
    observedCandidates: input.groundedCandidates,
    evidence: input.evidence,
  });
}
