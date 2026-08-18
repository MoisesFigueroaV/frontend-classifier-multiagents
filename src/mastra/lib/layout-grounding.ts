import type { LayoutAnalysis } from '../schemas/layout-analysis';
import type { EvidenceFile } from './evidence-routing';

/** Grid requires structure, never a component name such as AnimatedGridPattern. */
export function hasExplicitGridLayoutEvidence(files: EvidenceFile[]) {
  return files.some((file) =>
    /(?:\bdisplay\s*:\s*grid\b|\bgrid-template-(?:columns|rows)\b|\bgrid-(?:cols|rows|flow|auto)-(?:\[[^\]]+\]|[\w-]+)\b|(?:class|className)\s*=\s*["'`][^"'`]*\bgrid\b)/i.test(file.content),
  );
}

function describesGrid(pattern: LayoutAnalysis['compositionPatterns'][number]) {
  return /\bgrid(?:-based)?\b/i.test(`${pattern.name} ${pattern.description}`);
}

/**
 * Removes only unsupported grid claims. It deliberately leaves all non-grid
 * composition analysis untouched and does not reinterpret component names.
 */
export function normalizeLayoutAnalysis(
  analysis: LayoutAnalysis,
  evidence: EvidenceFile[],
): LayoutAnalysis {
  if (hasExplicitGridLayoutEvidence(evidence)) return analysis;

  return {
    ...analysis,
    compositionPatterns: analysis.compositionPatterns.filter(
      (pattern) => !describesGrid(pattern),
    ),
  };
}
