import type { MotionAnalysis } from '../schemas/motion-analysis';
import type { EvidenceFile } from './evidence-routing';

export const motionNoEvidenceFallback = {
  dominantRange: 'insufficient evidence',
  dominantStyle: 'unspecified',
} as const;

export type MotionGroundingCandidates = {
  observedDurations: string[];
  observedEasings: string[];
  observedTransitionClasses: string[];
  observedAnimationClasses: string[];
  observedMotionProps: string[];
  observedHoverSignals: string[];
  observedTransforms: string[];
  observedKeyframes: string[];
  observedMotionFiles: string[];
  observedEntranceEffects: string[];
  observedExitEffects: string[];
  observedMicroInteractions: string[];
  observedScrollEffects: string[];
};

export type MotionGroundingValidation = {
  valid: boolean;
  unsupported: Record<string, string[]>;
};

function uniqueInOrder(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function classTokens(content: string, expression: RegExp) {
  return uniqueInOrder([...content.matchAll(expression)].map((match) => match[0]));
}

function hasAll(content: string, values: string[]) {
  return values.every((value) => content.includes(value));
}

function extractDurations(content: string) {
  return uniqueInOrder([
    ...classTokens(content, /\bduration-\d+/g),
    ...classTokens(content, /\b\d+(?:\.\d+)?(?:ms|s)\b/g),
    ...[...content.matchAll(/(?:duration|animation-duration|transitionDuration)\s*[:=]\s*["']?([^\s;,'"}]+)/gi)]
      .map((match) => match[1] ?? ''),
  ]);
}

function extractEasings(content: string) {
  return uniqueInOrder([
    ...classTokens(content, /\bease-(?:in-out|in|out|linear)\b/g),
    ...classTokens(content, /cubic-bezier\([^)]+\)/g),
    ...[...content.matchAll(/(?:ease|easing|transitionTimingFunction)\s*[:=]\s*["']?([^\s;,'"}]+)/gi)]
      .map((match) => match[1] ?? '')
      .filter((value) => !value.startsWith('[')),
  ]);
}

function extractMotionProps(content: string) {
  return uniqueInOrder([
    ...[...content.matchAll(/\b(initial|animate|exit|transition|whileHover|whileTap|whileInView|variants|layoutId?|useMotionValue|useSpring|useTransform|useAnimation)\s*(?:=|\()/g)]
      .map((match) => match[1] ?? ''),
    ...(content.includes('AnimatePresence') ? ['AnimatePresence'] : []),
  ]);
}

function extractTransforms(content: string) {
  return uniqueInOrder([
    ...[...content.matchAll(/\b(scale|rotate|translateX|translateY|x|y)\s*[:=]/g)]
      .map((match) => match[1] ?? ''),
    ...(classTokens(content, /\b(?:scale|rotate|translate-[xy])-[\w[\]/.-]+/g).length > 0 ? ['scale'] : []),
    ...(classTokens(content, /\brotate-[\w[\]/.-]+/g).length > 0 ? ['rotate'] : []),
  ]);
}

function hasFadeIn(content: string) {
  return hasAll(content, ['initial', 'animate']) && /opacity\s*:\s*0/.test(content) && /opacity\s*:\s*1/.test(content);
}

function hasFadeOut(content: string) {
  return content.includes('exit') && /opacity\s*:\s*0/.test(content);
}

function hasSlideUp(content: string) {
  return /(?:y|translateY)\s*:\s*["']?\d+/.test(content) && /(?:y|translateY)\s*:\s*0/.test(content);
}

function hasSlideDown(content: string) {
  return /(?:y|translateY)\s*:\s*-[\d]/.test(content) && /(?:y|translateY)\s*:\s*0/.test(content);
}

export function extractMotionGroundingCandidates(files: EvidenceFile[]): MotionGroundingCandidates {
  const content = files.map((file) => file.content).join('\n');
  const motionProps = extractMotionProps(content);
  const transforms = extractTransforms(content);
  const transitionClasses = classTokens(content, /\btransition(?:-[\w[\]/.-]+)?/g);
  const animationClasses = classTokens(content, /\banimate-[\w[\]/.-]+/g);
  const hoverSignals = uniqueInOrder([
    ...classTokens(content, /\b(?:group-)?hover:[^\s"'`]+/g),
    ...(motionProps.includes('whileHover') ? ['whileHover'] : []),
    ...(motionProps.includes('whileTap') ? ['whileTap'] : []),
  ]);

  return {
    observedDurations: extractDurations(content),
    observedEasings: extractEasings(content),
    observedTransitionClasses: transitionClasses,
    observedAnimationClasses: animationClasses,
    observedMotionProps: motionProps,
    observedHoverSignals: hoverSignals,
    observedTransforms: transforms,
    observedKeyframes: classTokens(content, /@keyframes\s+([\w-]+)/g),
    observedMotionFiles: files
      .filter((file) => /motion\.|AnimatePresence|@keyframes|\banimate-|\btransition-/.test(file.content))
      .map((file) => file.path),
    observedEntranceEffects: uniqueInOrder([
      ...(hasFadeIn(content) ? ['fade in'] : []),
      ...(hasSlideUp(content) ? ['slide up'] : []),
      ...(hasSlideDown(content) ? ['slide down'] : []),
      ...(content.includes('staggerChildren') ? ['staggered entrance'] : []),
    ]),
    observedExitEffects: hasFadeOut(content) ? ['fade out'] : [],
    observedMicroInteractions: uniqueInOrder([
      ...(motionProps.includes('whileTap') && transforms.includes('scale') ? ['button press'] : []),
      ...((animationClasses.includes('animate-spin') || /rotate\s*:\s*360/.test(content)) ? ['icon spin'] : []),
    ]),
    observedScrollEffects: uniqueInOrder([
      ...(motionProps.includes('whileInView') ? ['reveal on scroll'] : []),
      ...(content.includes('IntersectionObserver') ? ['reveal on scroll'] : []),
    ]),
  };
}

function unsupported(values: string[], allowed: string[]) {
  const allowedValues = new Set(allowed);
  return uniqueInOrder(values).filter((value) => !allowedValues.has(value));
}

function hasConcreteMotionBehavior(candidates: MotionGroundingCandidates) {
  return [
    candidates.observedDurations,
    candidates.observedEasings,
    candidates.observedHoverSignals,
    candidates.observedTransforms,
    candidates.observedKeyframes,
    candidates.observedAnimationClasses,
    candidates.observedEntranceEffects,
    candidates.observedExitEffects,
    candidates.observedMicroInteractions,
    candidates.observedScrollEffects,
  ].some((values) => values.length > 0);
}

export function validateMotionGrounding(
  analysis: MotionAnalysis,
  candidates: MotionGroundingCandidates,
): MotionGroundingValidation {
  const unsupportedValues: Record<string, string[]> = {
    durations: unsupported(analysis.transitionDurations.commonValues, candidates.observedDurations),
    easings: unsupported(analysis.easing.commonValues, candidates.observedEasings),
    hoverEffects: unsupported(analysis.hoverEffects, candidates.observedHoverSignals),
    entranceAnimations: unsupported(analysis.entranceAnimations, candidates.observedEntranceEffects),
    exitAnimations: unsupported(analysis.exitAnimations, candidates.observedExitEffects),
    microInteractions: unsupported(analysis.microInteractions, candidates.observedMicroInteractions),
    transformPatterns: unsupported(analysis.transformPatterns, candidates.observedTransforms),
    scrollEffects: unsupported(analysis.scrollEffects, candidates.observedScrollEffects),
  };

  // Imports such as AnimatePresence and package metadata are evidence that a
  // symbol/library exists, not evidence of a visual motion language.
  if (!hasConcreteMotionBehavior(candidates)) {
    if (analysis.motionIntensity !== 'none') {
      unsupportedValues.motionIntensity = [analysis.motionIntensity];
    }
    if (analysis.consistency !== 'low') {
      unsupportedValues.consistency = [analysis.consistency];
    }
    if (analysis.patterns.length > 0) {
      unsupportedValues.patterns = analysis.patterns.map((pattern) => pattern.name);
    }
    if (analysis.motionStyle.length > 0) {
      unsupportedValues.motionStyle = analysis.motionStyle;
    }
  }

  return {
    valid: Object.values(unsupportedValues).every((values) => values.length === 0),
    unsupported: unsupportedValues,
  };
}

export function buildMotionGroundingRepairPrompt(
  invalidObject: Record<string, unknown>,
  validation: MotionGroundingValidation,
  candidates: MotionGroundingCandidates,
) {
  return JSON.stringify({
    task: 'Repair unsupported motion analysis values.',
    instructions: [
      'Return only one corrected JSON object.',
      'Remove every unsupported value listed below.',
      'Only return exact durations, easings, motion effects, transforms, and scroll effects present in observedCandidates.',
      'Do not treat an imported library as evidence of an effect.',
      'When observedCandidates has no concrete behavior, use motionIntensity "none", consistency "low", and empty motionStyle and patterns arrays.',
      'Do not add prose outside the structured object.',
    ],
    invalidObject,
    unsupportedValues: validation.unsupported,
    observedCandidates: candidates,
  });
}
