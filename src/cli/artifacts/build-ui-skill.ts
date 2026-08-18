import type { ArtifactBuilder } from './artifact-types';
import { bulletList, heading } from './markdown';

const MAX_REPRESENTATIVE_COLORS = 4;
const MAX_REPRESENTATIVE_GRADIENTS = 3;
const MAX_REPRESENTATIVE_PATHS = 12;

function isNeutralColor(value: string) {
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) return /^(?:white|black|transparent)$/i.test(value);

  const channels = [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
  return Math.max(...channels) - Math.min(...channels) <= 12;
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function representativePaths(classification: Parameters<ArtifactBuilder>[0]) {
  return uniqueValues([
    ...classification.visualStyle.evidence.flatMap((item) => item.sources),
    ...classification.components.evidence.flatMap((item) => item.sources),
    ...classification.layout.evidence.flatMap((item) => item.sources),
    ...classification.motion.evidence.flatMap((item) => item.sources),
    ...classification.typography.declaredFonts.map((item) => item.source),
    ...classification.colors.colors.flatMap((item) => item.sources),
    ...classification.colors.cssVariables.map((item) => item.source),
    ...classification.colors.gradients.map((item) => item.source),
  ]).slice(0, MAX_REPRESENTATIVE_PATHS);
}

function observedGradientKinds(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const kind = value.match(/\b(?:linear|radial|conic)-gradient/i)?.[0]?.toLowerCase()
      ?? 'gradient';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  return [...counts.entries()].map(([kind, count]) =>
    `${kind} (${count.toString()} observed)`,
  );
}

export const buildUiSkill: ArtifactBuilder = (classification) => {
  const { project, visualStyle, components, layout, motion, typography, colors } = classification;
  const representativeColors = colors.colors.slice(0, MAX_REPRESENTATIVE_COLORS);
  const neutralSurfaces = representativeColors
    .filter((color) => isNeutralColor(color.value))
    .map((color) => color.value);
  const accents = representativeColors
    .filter((color) => !isNeutralColor(color.value))
    .map((color) => color.value);
  const primaryAccent = accents.at(0);
  const supportingAccents = accents.slice(1);
  const paths = representativePaths(classification);

  const colorGuidelines = [
    primaryAccent
      ? `Use ${primaryAccent} as the most frequently observed non-neutral accent.`
      : undefined,
    neutralSurfaces.length > 0
      ? `Preserve the observed neutral surfaces: ${neutralSurfaces.join(', ')}.`
      : undefined,
    accents.length > 0 && neutralSurfaces.length > 0
      ? 'Preserve the observed contrast between neutral surfaces and accent colors.'
      : undefined,
  ].filter((guideline): guideline is string => Boolean(guideline));

  const doGuidance = [
    `Do preserve the observed ${visualStyle.consistency} visual consistency and ${layout.contentDensity} content density.`,
    `Do use the documented component families and patterns: ${components.componentFamilies.join(', ') || 'only those supported by the classification'}.`,
    `Do retain the observed hierarchy techniques: ${layout.hierarchy.techniques.join(', ') || 'no techniques were identified'}.`,
  ];
  const dontGuidance = [
    'Do not introduce component variants, interaction states, borders, or shadows that are not present in the classification.',
    'Do not add motion patterns beyond the observed motion language and evidence.',
  ];

  return {
    fileName: 'UI_SKILL.md',
    content: `# UI Skill: ${project.name}

Reusable implementation guidance derived deterministically from FrontendClassification. It is compact by design; use \`classification.json\` for the exhaustive, machine-readable source of truth.

${heading('Visual identity', `- Primary style: ${visualStyle.primaryStyle}
- Secondary styles: ${visualStyle.secondaryStyles.join(', ') || 'No additional styles identified.'}
- Personality: ${visualStyle.personality.join(', ') || 'Not identified.'}
- Formality: ${visualStyle.formality}
- Visual density: ${visualStyle.visualDensity}
- Complexity: ${visualStyle.complexity}`)}

${heading('Design principles', bulletList([
  `Maintain ${visualStyle.consistency} visual consistency across surfaces.`,
  `Preserve ${layout.hierarchy.strength} hierarchy through ${layout.hierarchy.techniques.join(', ') || 'the observed hierarchy techniques'}.`,
  `Follow the observed ${components.reuseLevel} component reuse level and ${layout.spacing.consistency} spacing consistency.`,
]))}

${heading('Color system', `### Primary accent

${primaryAccent ? `- ${primaryAccent}` : '- No non-neutral accent identified.'}

### Supporting accents

${bulletList(supportingAccents)}

### Neutral surfaces

${bulletList(neutralSurfaces)}

### Observed gradient forms

${bulletList(observedGradientKinds(colors.gradients.map((gradient) => gradient.value)).slice(0, MAX_REPRESENTATIVE_GRADIENTS))}

### Guidance

${bulletList(colorGuidelines)}`)}

${heading('Typography rules', `- Families: ${typography.fontFamilies.join(', ') || 'No families identified.'}
- Observed weights: ${typography.fontWeights.join(', ') || 'No weights identified.'}
- Observed sizes: ${typography.fontSizes.join(', ') || 'No sizes identified.'}

Use only the families, weights, and size values recorded above unless the exhaustive classification provides further evidence.`)}

${heading('Component language', `- Component families: ${components.componentFamilies.join(', ') || 'No families identified.'}
- Observed variants: ${components.variants.join(', ') || 'No variants evidenced.'}
- Interaction states: ${components.interactionStates.join(', ') || 'No states evidenced.'}
- Reuse level: ${components.reuseLevel}

### Reusable patterns

${bulletList(components.patterns.map((pattern) => `${pattern.name}: ${pattern.description}`))}`)}

${heading('Shape, borders, and shadows', `- Dominant radius: ${components.shapeLanguage.dominantRadius}
- Common shapes: ${components.shapeLanguage.commonShapes.join(', ') || 'No shapes identified.'}
- Borders (${components.borders.usage}): ${components.borders.styles.join(', ') || 'No styles evidenced.'}
- Shadows (${components.shadows.usage}): ${components.shadows.styles.join(', ') || 'No styles evidenced.'}`)}

${heading('Layout, spacing, and hierarchy', `- Structure: ${layout.pageStructure.dominantType}
- Section flow: ${layout.pageStructure.sectionFlow.join(' → ') || 'No flow identified.'}
- Alignment: ${layout.alignment.dominant} (${layout.alignment.consistency})
- Spacing: ${layout.spacing.overall} (${layout.spacing.consistency})
- Navigation: ${layout.navigationPatterns.join(', ') || 'No patterns identified.'}

### Responsive behavior

- Confidence: ${layout.responsiveBehavior.confidence}
- Patterns: ${layout.responsiveBehavior.patterns.join(', ') || 'No patterns evidenced.'}`)}

${heading('Motion and interaction language', `- Intensity: ${motion.motionIntensity}
- Motion style: ${motion.motionStyle.join(', ') || 'No style evidenced.'}
- Transition range: ${motion.transitionDurations.dominantRange}
- Observed durations: ${motion.transitionDurations.commonValues.join(', ') || 'No durations evidenced.'}
- Easing: ${motion.easing.dominantStyle}; ${motion.easing.commonValues.join(', ') || 'no easings evidenced.'}
- Hover effects: ${motion.hoverEffects.join(', ') || 'No effects evidenced.'}
- Entrance / exit: ${motion.entranceAnimations.join(', ') || 'No entrances evidenced.'} / ${motion.exitAnimations.join(', ') || 'No exits evidenced.'}
- Microinteractions: ${motion.microInteractions.join(', ') || 'No microinteractions evidenced.'}

### Reusable motion patterns

${bulletList(motion.patterns.map((pattern) => `${pattern.name}: ${pattern.description}`))}`)}

${heading('Do / do not', `### Do

${bulletList(doGuidance)}

### Do not

${bulletList(dontGuidance)}`)}

${heading('Representative evidence', bulletList(paths.map((path) => `\`${path}\``)))}
`,
  };
};
