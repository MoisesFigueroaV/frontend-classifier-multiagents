import {
  extractComponentGroundingCandidates,
  normalizeComponentAnalysis,
  validateComponentGrounding,
} from '../mastra/lib/component-grounding';
import { extractMotionGroundingCandidates, motionNoEvidenceFallback, validateMotionGrounding } from '../mastra/lib/motion-grounding';
import { buildVisualSpecialistPrompt, getVisualPayloadBreakdown } from '../mastra/lib/specialist-prompts';
import { colorThemeAnalysisSchema, frontendClassificationSchema, typographyAnalysisSchema } from '../mastra/schemas/frontend-classification';
import { projectContextSchema } from '../mastra/schemas/project-context';
import { motionAnalysisSchema } from '../mastra/schemas/motion-analysis';
import { extractTypographyTool } from '../mastra/tools/extract-typography-tool';
import { hasExplicitGridLayoutEvidence, normalizeLayoutAnalysis } from '../mastra/lib/layout-grounding';
import { layoutAnalysisSchema } from '../mastra/schemas/layout-analysis';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Deterministic check failed: ${message}`);
}

const projectContext = projectContextSchema.parse({
  project: { name: 'fixture', isFrontend: true, framework: 'react', language: 'typescript' },
  libraries: { ui: [], styling: [], motion: [] },
  structure: { componentDirectories: [], pageDirectories: [], styleDirectories: [], themeFiles: [] },
  relevantFiles: { frontend: [], components: [], pages: [], styles: [], themes: [] },
});
const typography = typographyAnalysisSchema.parse({
  fontFamilies: ['Inter'], fontWeights: [400], fontSizes: ['16px'], declaredFonts: [{ family: 'Inter', source: 'src/fonts.css' }],
  evidence: Array.from({ length: 20 }, (_, index) => ({ value: 'Inter', property: 'font-family', source: `src/font-${index}.css` })),
});
const colors = colorThemeAnalysisSchema.parse({
  colors: [{ value: '#123456', count: 400, sources: Array.from({ length: 30 }, (_, index) => `src/color-${index}.css`) }],
  cssVariables: Array.from({ length: 80 }, (_, index) => ({ name: `--primary-${index}`, value: '#123456', source: `src/theme-${index}.css` })),
  gradients: [{ value: 'linear-gradient(#123456, #ffffff)', source: 'src/theme.css' }],
  evidence: Array.from({ length: 50 }, (_, index) => ({ value: '#123456', property: 'color', source: `src/color-${index}.css` })),
});
const visualEvidence = [{ path: 'src/App.tsx', content: 'x'.repeat(12_000) }];
const visualPrompt = buildVisualSpecialistPrompt({ projectContext, typography, colors, evidence: visualEvidence });
const visualMetrics = getVisualPayloadBreakdown({ projectContext, typography, colors, evidence: visualEvidence });
assert(!visualPrompt.includes('src/color-29.css'), 'Visual prompt must omit exhaustive color sources.');
assert(!visualPrompt.includes('src/theme-79.css'), 'Visual prompt must omit exhaustive CSS-variable sources.');
assert(visualMetrics.after.total < visualMetrics.before.total, 'Visual prompt must be smaller than exhaustive payload.');
assert(frontendClassificationSchema.shape.colors.parse(colors).cssVariables.length === 80, 'Classification data must retain exhaustive CSS variables.');
assert(frontendClassificationSchema.shape.typography.parse(typography).evidence.length === 20, 'Classification data must retain typography evidence.');

const candidates = extractComponentGroundingCandidates([{
  path: 'src/components/panel.tsx',
  content: `import { DialogContent } from '@/components/ui/dialog'; import { SheetContent } from '@/components/ui/sheet'; import { Input } from '@/components/ui/input'; import { useRender } from '@base-ui/react/use-render'; const ThemeProviderState = {}; const $shareToken = 'x'; const $tableToken = 'y'; :root { --radius: 1.15rem; } export function Panel() { return <><DialogContent /><SheetContent /><Input /></>; }`,
}]);
for (const family of ['Dialog', 'Sheet', 'Input']) assert(candidates.observedComponentFamilies.includes(family), `${family} must be grounded by import/use evidence.`);
for (const invalid of ['ThemeProviderState', '$shareToken', '$tableToken', 'UseRender']) assert(!candidates.observedComponentFamilies.includes(invalid), `${invalid} must not be a UI family.`);
assert(candidates.allowedSemanticShapes.includes('rounded'), 'A radius token must permit rounded.');
assert(extractComponentGroundingCandidates([{ path: 'src/plain.tsx', content: 'export const Plain = () => <div />;' }]).allowedSemanticShapes.length === 0, 'Rounded must not be inferred without radius evidence.');
const componentValidation = validateComponentGrounding({
  componentFamilies: ['Dialog', 'Sheet', 'Input'], shapeLanguage: { dominantRadius: 'large', commonShapes: ['rounded'] }, borders: { usage: 'none', styles: [] }, shadows: { usage: 'none', styles: [] }, variants: [], interactionStates: [], consistency: 'high', reuseLevel: 'high', patterns: [], evidence: [{ observation: 'UI imports', sources: ['src/components/panel.tsx'] }], reasoningSummary: 'Observed UI imports and radius token.',
}, candidates);
assert(componentValidation.valid, 'Grounded Dialog, Sheet, Input, and rounded must validate.');
for (const family of ['Card', 'Navigation']) {
  assert(!candidates.observedComponentFamilies.includes(family), `${family} must not enter the vocabulary without evidence.`);
}
assert(!validateComponentGrounding({
  componentFamilies: ['Card'], shapeLanguage: { dominantRadius: 'none', commonShapes: [] }, borders: { usage: 'none', styles: [] }, shadows: { usage: 'none', styles: [] }, variants: [], interactionStates: [], consistency: 'low', reuseLevel: 'low', patterns: [], evidence: [{ observation: 'Unsupported card', sources: ['src/components/panel.tsx'] }], reasoningSummary: 'Card was not observed.',
}, candidates).valid, 'Card must fail validation without evidence.');
const cardAndNavigationCandidates = extractComponentGroundingCandidates([{
  path: 'src/components/card.tsx',
  content: `import { NavigationMenu } from '@/components/ui/navigation-menu'; export const Card = () => <NavigationMenu />;`,
}]);
assert(cardAndNavigationCandidates.observedComponentFamilies.includes('Card'), 'Card must pass with local implementation evidence.');
assert(cardAndNavigationCandidates.observedComponentFamilies.includes('NavigationMenu'), 'NavigationMenu must pass with import/JSX evidence.');
assert(validateComponentGrounding({
  componentFamilies: ['Card'], shapeLanguage: { dominantRadius: 'none', commonShapes: [] }, borders: { usage: 'none', styles: [] }, shadows: { usage: 'none', styles: [] }, variants: [], interactionStates: [], consistency: 'low', reuseLevel: 'low', patterns: [], evidence: [{ observation: 'Card implementation', sources: ['src/components/card.tsx'] }], reasoningSummary: 'Card is locally implemented.',
}, cardAndNavigationCandidates).valid, 'Card must validate only when grounded.');
const normalized = normalizeComponentAnalysis({
  componentFamilies: ['Alert', 'AlertTitle', 'AlertDescription', 'Sheet', 'SheetContent', 'SheetHeader'], shapeLanguage: { dominantRadius: 'none', commonShapes: [] }, borders: { usage: 'none', styles: [] }, shadows: { usage: 'none', styles: [] }, variants: [], interactionStates: [], consistency: 'high', reuseLevel: 'high', patterns: [], evidence: [{ observation: 'Families', sources: ['src/ui.tsx'] }], reasoningSummary: 'Families are grouped.',
});
assert(JSON.stringify(normalized.componentFamilies) === JSON.stringify(['Alert', 'Sheet']), 'Primitives must normalize to their conceptual family.');

const noMotion = motionAnalysisSchema.parse({
  transitionDurations: { commonValues: [], dominantRange: motionNoEvidenceFallback.dominantRange }, easing: { commonValues: [], dominantStyle: motionNoEvidenceFallback.dominantStyle }, hoverEffects: [], entranceAnimations: [], exitAnimations: [], microInteractions: [], transformPatterns: [], scrollEffects: [], motionIntensity: 'none', motionStyle: [], consistency: 'low', patterns: [], evidence: [{ observation: 'No motion configuration in evidence.', sources: ['src/App.tsx'] }], reasoningSummary: 'No concrete motion configuration was observed.',
});
assert(noMotion.transitionDurations.dominantRange === 'insufficient evidence', 'Motion duration fallback must be non-empty.');
assert(noMotion.easing.dominantStyle === 'unspecified', 'Motion easing fallback must be non-empty.');
const presenceOnlyCandidates = extractMotionGroundingCandidates([{
  path: 'src/presence.tsx',
  content: `import { AnimatePresence } from 'framer-motion'; export const Presence = () => <AnimatePresence />;`,
}]);
const presenceOnlyAnalysis = motionAnalysisSchema.parse({
  ...noMotion,
  evidence: [{ observation: 'AnimatePresence is used.', sources: ['src/presence.tsx'] }],
});
assert(validateMotionGrounding(presenceOnlyAnalysis, presenceOnlyCandidates).valid, 'AnimatePresence alone must keep the no-motion result valid.');
const inferredPresenceAnalysis = motionAnalysisSchema.parse({
  ...presenceOnlyAnalysis,
  motionIntensity: 'subtle', consistency: 'medium', patterns: [{ name: 'Presence-based transitions', description: 'Inferred from AnimatePresence.' }],
});
assert(!validateMotionGrounding(inferredPresenceAnalysis, presenceOnlyCandidates).valid, 'AnimatePresence alone must not permit inferred motion behavior.');

const extractedFontsResult = await extractTypographyTool.execute!({
  files: [
    { path: 'src/layout.tsx', content: `import { Geist, Geist_Mono } from 'next/font/google'; const font = Geist({ variable: '--font-geist' });` },
    { path: 'src/styles.css', content: `@import "@fontsource-variable/inter"; @import "@fontsource-variable/jetbrains-mono"; :root { --font-sans: "Inter Variable", sans-serif; --font-mono: "JetBrains Mono Variable", monospace; }` },
    { path: 'src/plain.tsx', content: `const className = 'font-[family:var(--font-sans)]';` },
  ],
}, {} as never);
const extractedFonts = typographyAnalysisSchema.parse(extractedFontsResult);
for (const family of ['Geist', 'Geist Mono', 'Inter', 'JetBrains Mono', 'Inter Variable', 'JetBrains Mono Variable']) {
  assert(extractedFonts.fontFamilies.includes(family), `${family} must require and retain deterministic source evidence.`);
}
assert(!extractedFonts.fontFamilies.includes('Unobserved Font'), 'A font name must never appear without deterministic evidence.');

const gridClaim = layoutAnalysisSchema.parse({
  pageStructure: { dominantType: 'mixed', sectionFlow: [] }, contentDensity: 'medium',
  spacing: { overall: 'balanced', consistency: 'medium' }, hierarchy: { strength: 'medium', techniques: [] },
  alignment: { dominant: 'mixed', consistency: 'medium' }, navigationPatterns: [],
  responsiveBehavior: { confidence: 'low', patterns: [] },
  compositionPatterns: [{ name: 'grid-based product listing', description: 'Inferred from AnimatedGridPattern.' }],
  consistency: 'medium', evidence: [{ observation: 'AnimatedGridPattern is imported.', sources: ['src/animated-grid.tsx'] }], reasoningSummary: 'Only a component name was observed.',
});
const gridNameOnlyEvidence = [{ path: 'src/animated-grid.tsx', content: 'export const AnimatedGridPattern = () => <div />;' }];
assert(!hasExplicitGridLayoutEvidence(gridNameOnlyEvidence), 'A GridPattern component name is not grid layout evidence.');
assert(normalizeLayoutAnalysis(gridClaim, gridNameOnlyEvidence).compositionPatterns.length === 0, 'Unsupported grid composition claims must be removed.');
const explicitGridEvidence = [{ path: 'src/catalog.tsx', content: '<section className="grid grid-cols-3 gap-4" />' }];
assert(hasExplicitGridLayoutEvidence(explicitGridEvidence), 'Tailwind grid structure must count as grid evidence.');
assert(normalizeLayoutAnalysis(gridClaim, explicitGridEvidence).compositionPatterns.length === 1, 'A grid claim must remain when structural evidence exists.');

console.info('Deterministic checks passed.');
