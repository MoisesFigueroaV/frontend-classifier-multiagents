import type { ComponentAnalysis } from '../schemas/component-analysis';
import type { EvidenceFile } from './evidence-routing';

export type ComponentGroundingCandidates = {
  observedComponentFamilies: string[];
  observedComponentFamilyEvidence: Array<{
    family: string;
    sources: string[];
    observations: Array<'import' | 'jsx' | 'local-implementation'>;
  }>;
  allowedSemanticShapes: string[];
  observedVariants: string[];
  observedInteractionStates: string[];
  observedRadiusClasses: string[];
  observedBorderClasses: string[];
  observedShadowClasses: string[];
};

export type ComponentEvidenceAudit = {
  path: string;
  chars: number;
  uiImports: string[];
  variants: string[];
  states: string[];
  radiusClasses: string[];
  borderClasses: string[];
  shadowClasses: string[];
};

export type ComponentGroundingValidation = {
  valid: boolean;
  unsupported: Record<string, string[]>;
};

function uniqueInOrder(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function findBalancedBlock(content: string, openIndex: number) {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;

  for (let index = openIndex; index < content.length; index += 1) {
    const character = content[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === '`') {
      quote = character;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return content.slice(openIndex, index + 1);
    }
  }

  return undefined;
}

function objectBlockAfterKey(content: string, key: string, startIndex = 0) {
  const expression = new RegExp(`\\b${key}\\s*:\\s*\\{`, 'g');
  expression.lastIndex = startIndex;
  const match = expression.exec(content);
  if (!match || match.index === undefined) return undefined;

  const openIndex = match.index + match[0].lastIndexOf('{');
  return findBalancedBlock(content, openIndex);
}

function directObjectKeys(content: string) {
  return uniqueInOrder(
    [...content.matchAll(/(?:^|[,{]\s*)(?:["']([^"']+)["']|([\w-]+))\s*:/g)]
      .map((match) => match[1] ?? match[2] ?? '')
      .filter((value) => !['class', 'className'].includes(value)),
  );
}

function extractVariants(content: string) {
  const values: string[] = [];

  for (const match of content.matchAll(
    /\bvariant\s*=\s*(?:["']([^"']+)["']|\{\s*["']([^"']+)["']\s*\})/g,
  )) {
    values.push(match[1] ?? match[2] ?? '');
  }

  let searchIndex = 0;
  while (searchIndex < content.length) {
    const variantsBlock = objectBlockAfterKey(content, 'variants', searchIndex);
    if (!variantsBlock) break;
    searchIndex = content.indexOf(variantsBlock, searchIndex) + variantsBlock.length;

    const dimensions = variantsBlock.matchAll(/(?:^|[,{]\s*)(?:["']([^"']+)["']|([\w-]+))\s*:\s*\{/g);
    for (const dimension of dimensions) {
      const openIndex = dimension.index + dimension[0].lastIndexOf('{');
      const dimensionBlock = findBalancedBlock(variantsBlock, openIndex);
      if (dimensionBlock) values.push(...directObjectKeys(dimensionBlock));
    }
  }

  return uniqueInOrder(values);
}

function extractStates(content: string) {
  const values: string[] = [];
  for (const match of content.matchAll(/(?:^|\s)(hover|focus|focus-visible|active|disabled|group-hover):/g)) {
    values.push(match[1] ?? '');
  }
  for (const match of content.matchAll(/\baria-([\w-]+)/g)) {
    values.push(`aria-${match[1] ?? ''}`);
  }
  for (const match of content.matchAll(/\bdata-\[state=([^\]]+)\]/g)) {
    values.push(`data-state=${match[1] ?? ''}`);
  }
  for (const match of content.matchAll(/\bdata-state\s*=\s*["']([^"']+)["']/g)) {
    values.push(`data-state=${match[1] ?? ''}`);
  }
  for (const state of ['loading', 'checked', 'selected', 'readonly']) {
    if (new RegExp(`\\b${state}\\b`).test(content)) values.push(state);
  }
  return uniqueInOrder(values);
}

function extractClassLikeValues(content: string, expression: RegExp, properties: string[]) {
  const values = [...content.matchAll(expression)].map((match) => match[0]);
  for (const property of properties) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`).test(content)) {
      values.push(property);
    }
  }
  return uniqueInOrder(values);
}

function extractUiImports(content: string) {
  return uniqueInOrder(
    [...content.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)]
      .map((match) => match[1] ?? '')
      .filter((specifier) => /(?:components?|ui|primitives|design-system)/i.test(specifier)),
  );
}

function componentFamilyFromPath(path: string) {
  const fileName = path.split('/').at(-1) ?? '';
  const rawName = fileName.replace(/\.[^.]+$/, '');
  return rawName
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join('');
}

const invalidFamilyNames = new Set([
  'style', 'styles', 'theme', 'themeprovider', 'provider', 'hooks', 'hook',
  'utils', 'util', 'types', 'type', 'constants', 'constant', 'schemas',
  'schema', 'services', 'service', 'index', 'page', 'route', 'layout',
]);

function isComponentFamily(value: string) {
  const normalized = value.replace(/[\s_-]/g, '').toLowerCase();
  return /^[A-Z][A-Za-z0-9]*$/.test(value) &&
    !value.startsWith('$') &&
    !invalidFamilyNames.has(normalized) &&
    !/^(?:use[A-Z].*|Use[A-Z].*|[A-Z].*(?:Hook|Provider|Context|State|Config|Token|Props|Options|Ref|Element))$/.test(value);
}

function componentFamilyFromSpecifier(specifier: string) {
  const segment = specifier
    .replace(/[?#].*$/, '')
    .split('/')
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.[^.]+$/, '');
  if (!segment) return undefined;
  return segment
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join('');
}

function extractImportedComponentNames(content: string) {
  const names: string[] = [];
  for (const match of content.matchAll(/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g)) {
    const bindings = match[1] ?? '';
    const specifier = match[2] ?? '';
    if (!/(?:components?|ui|primitives|design-system)/i.test(specifier)) continue;

    for (const binding of bindings.matchAll(/\b([A-Z][A-Za-z0-9]*)\b/g)) {
      names.push(binding[1] ?? '');
    }
  }
  return names;
}

function extractComponentFamiliesFromImportPaths(content: string) {
  return [...content.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)]
    .map((match) => match[1] ?? '')
    .filter((specifier) => /(?:components?|ui|primitives|design-system)/i.test(specifier))
    .map(componentFamilyFromSpecifier)
    .filter((value): value is string => Boolean(value));
}

function extractJsxComponentNames(content: string) {
  return [...content.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].map((match) => match[1] ?? '');
}

function extractComponentFamilyEvidence(files: EvidenceFile[]) {
  const observations = new Map<
    string,
    { sources: Set<string>; observations: Set<'import' | 'jsx' | 'local-implementation'> }
  >();
  const add = (
    family: string | undefined,
    source: string,
    observation: 'import' | 'jsx' | 'local-implementation',
  ) => {
    if (!family || !isComponentFamily(family)) return;
    const current = observations.get(family) ?? {
      sources: new Set<string>(),
      observations: new Set<'import' | 'jsx' | 'local-implementation'>(),
    };
    current.sources.add(source);
    current.observations.add(observation);
    observations.set(family, current);
  };

  for (const file of files) {
    add(componentFamilyFromPath(file.path), file.path, 'local-implementation');
    for (const name of extractImportedComponentNames(file.content)) add(name, file.path, 'import');
    for (const name of extractComponentFamiliesFromImportPaths(file.content)) add(name, file.path, 'import');
    for (const name of extractJsxComponentNames(file.content)) add(name, file.path, 'jsx');
  }

  return [...observations.entries()].map(([family, observation]) => ({
    family,
    sources: [...observation.sources].sort(),
    observations: [...observation.observations].sort(),
  }));
}

export function auditComponentEvidence(files: EvidenceFile[]): ComponentEvidenceAudit[] {
  return files.map((file) => ({
    path: file.path,
    chars: file.content.length,
    uiImports: extractUiImports(file.content),
    variants: extractVariants(file.content),
    states: extractStates(file.content),
    radiusClasses: extractClassLikeValues(
      file.content,
      /\brounded(?:-(?:\[[^\s"'`]+\]|[\w./:-]+))?/g,
      ['border-radius', '--radius'],
    ),
    borderClasses: extractClassLikeValues(
      file.content,
      /\bborder(?:-(?:\[[^\s"'`]+\]|[\w./:-]+))?/g,
      ['borderWidth', 'borderColor'],
    ),
    shadowClasses: extractClassLikeValues(
      file.content,
      /\bshadow(?:-(?:\[[^\s"'`]+\]|[\w./:-]+))?/g,
      ['box-shadow', 'boxShadow'],
    ),
  }));
}

export function extractComponentGroundingCandidates(
  files: EvidenceFile[],
): ComponentGroundingCandidates {
  const audit = auditComponentEvidence(files);
  const familyEvidence = extractComponentFamilyEvidence(files);
  return {
    observedComponentFamilies: familyEvidence.map((observation) => observation.family),
    observedComponentFamilyEvidence: familyEvidence,
    allowedSemanticShapes: uniqueInOrder(
      audit.flatMap((item) => item.radiusClasses).some(
        (radius) => radius === '--radius' || radius === 'border-radius' || /^rounded(?:-|$)/.test(radius),
      )
        ? ['rounded']
        : [],
    ),
    observedVariants: uniqueInOrder(audit.flatMap((item) => item.variants)),
    observedInteractionStates: uniqueInOrder(audit.flatMap((item) => item.states)),
    observedRadiusClasses: uniqueInOrder(audit.flatMap((item) => item.radiusClasses)),
    observedBorderClasses: uniqueInOrder(audit.flatMap((item) => item.borderClasses)),
    observedShadowClasses: uniqueInOrder(audit.flatMap((item) => item.shadowClasses)),
  };
}

function unsupportedValues(values: string[], allowed: string[]) {
  const allowedValues = new Set(allowed);
  return uniqueInOrder(values).filter((value) => !allowedValues.has(value));
}

export function validateComponentGrounding(
  analysis: ComponentAnalysis,
  candidates: ComponentGroundingCandidates,
): ComponentGroundingValidation {
  const unsupported = {
    componentFamilies: unsupportedValues(
      analysis.componentFamilies,
      candidates.observedComponentFamilies,
    ),
    variants: unsupportedValues(analysis.variants, candidates.observedVariants),
    interactionStates: unsupportedValues(
      analysis.interactionStates,
      candidates.observedInteractionStates,
    ),
    commonShapes: unsupportedValues(
      analysis.shapeLanguage.commonShapes,
      candidates.allowedSemanticShapes,
    ),
    borderStyles: unsupportedValues(
      analysis.borders.styles,
      candidates.observedBorderClasses,
    ),
    shadowStyles: unsupportedValues(
      analysis.shadows.styles,
      candidates.observedShadowClasses,
    ),
  };

  return {
    valid: Object.values(unsupported).every((values) => values.length === 0),
    unsupported,
  };
}

export function normalizeComponentFamilies(values: string[]) {
  const families = uniqueInOrder(values);
  return families.filter((family) =>
    !families.some(
      (candidate) =>
        candidate !== family &&
        family.startsWith(candidate) &&
        /^[A-Z]/.test(family.slice(candidate.length)),
    ),
  );
}

export function normalizeComponentAnalysis(analysis: ComponentAnalysis): ComponentAnalysis {

  return {
    ...analysis,
    // AlertTitle and SheetContent remain grounded in repository evidence, while
    // this public field communicates conceptual families rather than primitives.
    componentFamilies: normalizeComponentFamilies(analysis.componentFamilies),
    variants: uniqueInOrder(analysis.variants),
    interactionStates: uniqueInOrder(analysis.interactionStates),
    shapeLanguage: {
      ...analysis.shapeLanguage,
      commonShapes: uniqueInOrder(analysis.shapeLanguage.commonShapes),
    },
    borders: {
      ...analysis.borders,
      styles: uniqueInOrder(analysis.borders.styles),
    },
    shadows: {
      ...analysis.shadows,
      styles: uniqueInOrder(analysis.shadows.styles),
    },
  };
}

export function buildComponentGroundingRepairPrompt(
  invalidObject: Record<string, unknown>,
  validation: ComponentGroundingValidation,
  candidates: ComponentGroundingCandidates,
) {
  return JSON.stringify({
    task: 'Repair unsupported component analysis values.',
    instructions: [
      'Return only one corrected JSON object.',
      'Remove every unsupported value listed below.',
      'For component families, variants, interaction states, shapes, borders, and shadows, use only observedCandidates.',
      'Keep evidence items only when they include at least one concrete repository source path.',
      'Do not add prose outside the structured object.',
    ],
    invalidObject,
    unsupportedValues: validation.unsupported,
    observedCandidates: candidates,
  });
}
