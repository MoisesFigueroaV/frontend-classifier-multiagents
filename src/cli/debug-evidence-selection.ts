import { inspectEvidenceSelection } from '../mastra/lib/evidence-routing';
import type { Specialist } from '../mastra/lib/evidence-routing';
import {
  auditComponentEvidence,
  extractComponentGroundingCandidates,
  normalizeComponentFamilies,
} from '../mastra/lib/component-grounding';
import { extractMotionGroundingCandidates, motionNoEvidenceFallback } from '../mastra/lib/motion-grounding';
import { buildVisualSpecialistPrompt, getVisualPayloadBreakdown } from '../mastra/lib/specialist-prompts';
import { buildAnalysisFiles, prioritizeAnalysisFiles } from '../mastra/workflows/frontend-analysis-workflow';
import { repositoryInspectorTool } from '../mastra/tools/repository-inspector-tool';
import { extractTypographyTool } from '../mastra/tools/extract-typography-tool';
import { extractColorThemeTool } from '../mastra/tools/extract-color-theme-tool';
import { projectContextSchema } from '../mastra/schemas/project-context';
import {
  colorThemeAnalysisSchema,
  typographyAnalysisSchema,
} from '../mastra/schemas/frontend-classification';
import { loadLocalRepository } from './repository/load-local-repository';

const repositoryPath = process.argv[2];

if (!repositoryPath) {
  throw new Error('Usage: bun run evidence:preflight -- <repository-path>');
}

const snapshot = await loadLocalRepository(repositoryPath);

// Deterministic-only mirror of the repository → extraction → Visual prompt path.
// No workflow and no agent.generate() are invoked by this preflight command.
const visualProjectContext = await repositoryInspectorTool.execute!(
  { projectName: snapshot.projectName, files: snapshot.files },
  {} as never,
);
if (!visualProjectContext) throw new Error('Repository inspection returned no project context.');
const parsedVisualProjectContext = projectContextSchema.parse(visualProjectContext);
const visualRelevantPaths = new Set([
  ...parsedVisualProjectContext.relevantFiles.frontend,
  ...parsedVisualProjectContext.relevantFiles.styles,
  ...parsedVisualProjectContext.relevantFiles.themes,
  ...parsedVisualProjectContext.relevantFiles.components,
  ...parsedVisualProjectContext.relevantFiles.pages,
]);
const visualRelevantFiles = snapshot.files.filter((file) => visualRelevantPaths.has(file.path));
const visualFilesForExtraction = visualRelevantFiles.length > 0 ? visualRelevantFiles : snapshot.files;
const [visualTypography, visualColors] = await Promise.all([
  extractTypographyTool.execute!({ files: visualFilesForExtraction }, {} as never),
  extractColorThemeTool.execute!({ files: visualFilesForExtraction }, {} as never),
]);
if (!visualTypography || !visualColors) throw new Error('Deterministic design extraction returned no data.');
const parsedVisualTypography = typographyAnalysisSchema.parse(visualTypography);
const parsedVisualColors = colorThemeAnalysisSchema.parse(visualColors);
const visualAnalysisFiles = buildAnalysisFiles(
  prioritizeAnalysisFiles(visualFilesForExtraction, parsedVisualProjectContext),
);
const visualSelection = inspectEvidenceSelection(visualAnalysisFiles, 'visual');
const visualEvidence = visualSelection.selected.map(({ path, charsIncluded }) => {
  const file = visualAnalysisFiles.find((item) => item.path === path);
  return { path, content: file?.content.slice(0, charsIncluded) ?? '' };
});
const visualBreakdown = getVisualPayloadBreakdown({
  projectContext: parsedVisualProjectContext,
  typography: parsedVisualTypography,
  colors: parsedVisualColors,
  evidence: visualEvidence,
});
const visualPrompt = buildVisualSpecialistPrompt({
  projectContext: parsedVisualProjectContext,
  typography: parsedVisualTypography,
  colors: parsedVisualColors,
  evidence: visualEvidence,
});

console.info('\nVISUAL PREFLIGHT:');
console.info('VISUAL BEFORE');
console.info(`colors chars: ${visualBreakdown.before.colors.toString()}`);
console.info(`cssVariables chars: ${visualBreakdown.before.cssVariables.toString()}`);
console.info(`typography chars: ${visualBreakdown.before.typography.toString()}`);
console.info(`evidence chars: ${visualBreakdown.before.evidence.toString()}`);
console.info(`total chars: ${visualBreakdown.before.total.toString()}`);
console.info('VISUAL AFTER');
console.info(`compact colors chars: ${visualBreakdown.after.compactColors.toString()}`);
console.info(`compact cssVariables chars: ${visualBreakdown.after.compactCssVariables.toString()}`);
console.info(`typography chars: ${visualBreakdown.after.typography.toString()}`);
console.info(`evidence chars: ${visualBreakdown.after.evidence.toString()}`);
console.info(`total chars: ${visualBreakdown.after.total.toString()}`);
console.info(`actual prompt chars: ${visualPrompt.length.toString()}`);

for (const specialist of ['components', 'motion'] as const satisfies Specialist[]) {
  const selection = inspectEvidenceSelection(snapshot.files, specialist);
  const title = specialist.toUpperCase();

  console.info(`\n${title} CANDIDATES:`);
  for (const candidate of selection.candidates.slice(0, 30)) {
    console.info(
      `${candidate.score.toString().padStart(3)} | ${candidate.path} | ${candidate.reasons.join('; ')}`,
    );
  }

  console.info(`\n${title} SELECTED:`);
  for (const candidate of selection.selected) {
    console.info(
      `- ${candidate.path} | ${candidate.charsIncluded.toString()} chars | ${candidate.signals.join(', ') || 'import/path relevance'}`,
    );
  }
  console.info(
    `${title} bundle: ${selection.selected.reduce((total, item) => total + item.charsIncluded, 0).toString()} chars across ${selection.selected.length.toString()} file(s).`,
  );

  if (specialist === 'components') {
    const selectedFiles = selection.selected.map(({ path, charsIncluded }) => {
      const file = snapshot.files.find((item) => item.path === path);
      return file ? { path, content: file.content.slice(0, charsIncluded) } : undefined;
    }).filter((file): file is { path: string; content: string } => Boolean(file));
    const audit = auditComponentEvidence(selectedFiles);
    const candidates = extractComponentGroundingCandidates(selectedFiles);

    console.info('\nCOMPONENT SELECTED FILES:');
    for (const selected of selection.selected) {
      console.info(
        `${selected.score.toString()} | ${selected.path} | ${selected.charsIncluded.toString()} chars | ${selected.reasons.join('; ')}`,
      );
    }

    console.info('\nCOMPONENT EVIDENCE AUDIT:');
    for (const file of audit) {
      console.info(`- ${file.path} (${file.chars.toString()} chars)`);
      console.info(`  UI imports: ${file.uiImports.join(', ') || '(none)'}`);
      console.info(`  Variants: ${file.variants.join(', ') || '(none)'}`);
      console.info(`  States: ${file.states.join(', ') || '(none)'}`);
      console.info(`  Radius: ${file.radiusClasses.join(', ') || '(none)'}`);
      console.info(`  Borders: ${file.borderClasses.join(', ') || '(none)'}`);
      console.info(`  Shadows: ${file.shadowClasses.join(', ') || '(none)'}`);
    }

    console.info('\nOBSERVED COMPONENT DATA:');
    console.info(`families: ${JSON.stringify(candidates.observedComponentFamilies)}`);
    console.info(`normalized families: ${JSON.stringify(normalizeComponentFamilies(candidates.observedComponentFamilies))}`);
    console.info('rejected candidates: providers, contexts, state objects, hooks, tokens, props, types, and schemas are excluded deterministically.');
    console.info(`variants: ${JSON.stringify(candidates.observedVariants)}`);
    console.info(`states: ${JSON.stringify(candidates.observedInteractionStates)}`);
    console.info(`radius: ${JSON.stringify(candidates.observedRadiusClasses)}`);
    console.info(`allowed semantic shapes: ${JSON.stringify(candidates.allowedSemanticShapes)}`);
    console.info(`borders: ${JSON.stringify(candidates.observedBorderClasses)}`);
    console.info(`shadows: ${JSON.stringify(candidates.observedShadowClasses)}`);
  }

  if (specialist === 'motion') {
    const selectedFiles = selection.selected.map(({ path, charsIncluded }) => {
      const file = snapshot.files.find((item) => item.path === path);
      return file ? { path, content: file.content.slice(0, charsIncluded) } : undefined;
    }).filter((file): file is { path: string; content: string } => Boolean(file));
    const candidates = extractMotionGroundingCandidates(selectedFiles);

    console.info('\nMOTION PREFLIGHT:');
    console.info(`durations: ${JSON.stringify(candidates.observedDurations)}`);
    console.info(`easings: ${JSON.stringify(candidates.observedEasings)}`);
    console.info(`motion props: ${JSON.stringify(candidates.observedMotionProps)}`);
    console.info(`transforms: ${JSON.stringify(candidates.observedTransforms)}`);
    console.info(`hover/tap: ${JSON.stringify(candidates.observedHoverSignals)}`);
    console.info(`transition classes: ${JSON.stringify(candidates.observedTransitionClasses)}`);
    console.info(`animation classes: ${JSON.stringify(candidates.observedAnimationClasses)}`);
    console.info(`keyframes: ${JSON.stringify(candidates.observedKeyframes)}`);
    console.info(`motion files: ${JSON.stringify(candidates.observedMotionFiles)}`);
    console.info(`fallback dominantRange: ${motionNoEvidenceFallback.dominantRange}`);
    console.info(`fallback dominantStyle: ${motionNoEvidenceFallback.dominantStyle}`);
  }
}
