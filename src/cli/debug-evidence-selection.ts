import { inspectEvidenceSelection } from '../mastra/lib/evidence-routing';
import type { Specialist } from '../mastra/lib/evidence-routing';
import {
  auditComponentEvidence,
  extractComponentGroundingCandidates,
} from '../mastra/lib/component-grounding';
import { loadLocalRepository } from './repository/load-local-repository';

const repositoryPath = process.argv[2];

if (!repositoryPath) {
  throw new Error('Usage: bun run evidence:preflight -- <repository-path>');
}

const snapshot = await loadLocalRepository(repositoryPath);

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
        `${selected.path} | ${selected.charsIncluded.toString()} chars | ${selected.reasons.join('; ')}`,
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
    console.info(`variants: ${JSON.stringify(candidates.observedVariants)}`);
    console.info(`states: ${JSON.stringify(candidates.observedInteractionStates)}`);
    console.info(`radius: ${JSON.stringify(candidates.observedRadiusClasses)}`);
    console.info(`borders: ${JSON.stringify(candidates.observedBorderClasses)}`);
    console.info(`shadows: ${JSON.stringify(candidates.observedShadowClasses)}`);
  }
}
