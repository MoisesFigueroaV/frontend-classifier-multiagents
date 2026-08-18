import { extname, posix } from 'node:path';

import type { ProjectContext } from '../schemas/project-context';

export type EvidenceFile = { path: string; content: string };
export type Specialist = 'visual' | 'components' | 'layout' | 'motion';

export type EvidenceCandidate = {
  path: string;
  score: number;
  reasons: string[];
  signals: string[];
};

export type EvidenceSelection = {
  candidates: EvidenceCandidate[];
  selected: Array<EvidenceCandidate & { charsIncluded: number }>;
};

const MAX_EVIDENCE_CHARS = 12_000;
const MAX_FOCUSED_FILE_CHARS = 3_000;
const MAX_IMPORT_DEPTH = 2;
const IMPORT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.css', '.scss'];

const componentSignals = [
  ['cva', /\bcva\s*\(/],
  ['variants', /\bvariants?\s*:/],
  ['size', /\bsize\s*:/],
  ['class-variance-authority', /\bclass-variance-authority\b/],
  ['rounded', /\brounded-/],
  ['border', /\bborder-/],
  ['shadow', /\bshadow-/],
  ['hover', /\bhover:/],
  ['focus', /\bfocus(?:-visible)?:/],
  ['active', /\bactive:/],
  ['disabled', /\bdisabled(?::|=)/],
  ['data-state', /\bdata-\[state(?:=|\])/],
  ['aria', /\baria-[\w-]+/],
  ['loading', /\bloading\b/],
  ['cn', /\bcn\s*\(/],
  ['className', /\bclassName\b/],
] as const;

const motionSignals = [
  ['motion', /\bmotion\s*\./i],
  ['AnimatePresence', /\bAnimatePresence\b/],
  ['initial', /\binitial\s*=/],
  ['animate', /\banimate\s*=/],
  ['exit', /\bexit\s*=/],
  ['variants', /\bvariants\s*=/],
  ['transition', /\btransition\s*=/],
  ['while interaction', /\bwhile(?:Hover|Tap|InView)\s*=/],
  ['layout', /\blayout(?:Id)?\s*=/],
  ['useMotionValue', /\buseMotionValue\b/],
  ['useSpring', /\buseSpring\b/],
  ['useTransform', /\buseTransform\b/],
  ['useAnimation', /\buseAnimation\b/],
  ['framer-motion', /\bframer-motion\b/],
  ['gsap', /\bgsap\b/],
  ['anime', /\banime\b/],
  ['spring', /\bspring\b/],
  ['keyframes', /@keyframes\b/i],
  ['animation', /\banimation(?:-duration|-delay|-timing-function)?\s*:/i],
  ['transition css', /\btransition(?:-duration|-delay|-timing-function)?\s*:/i],
  ['tailwind transition', /\btransition-/],
  ['tailwind duration', /\bduration-/],
  ['tailwind easing', /\bease-/],
  ['hover', /(?:group-)?hover:/i],
  ['tailwind animation', /\banimate-/],
  ['transform', /\b(?:transform|translate-|scale-|rotate-)/i],
  ['offset path', /\boffset-path\s*:/i],
] as const;

const patterns: Record<Specialist, RegExp> = {
  visual: /\.(?:css|scss|sass|less)$|theme|token|variable|color|font|tailwind/i,
  components: /component|\/(?:ui|widgets?|primitives?|design-system)\/|className|styled\(|variant|cva\(/i,
  layout: /page|route|layout|screen|grid|container|sidebar|header|footer/i,
  motion: /animation|transition|keyframes|framer-motion|\bmotion\b|\bgsap\b|animate-|duration-|ease-|whileHover|whileTap|whileInView|useAnimation|useMotionValue|useSpring|useTransform|transform|translate|scale|rotate|group-hover|AnimatePresence/i,
};

type Alias = { prefix: string; target: string; configDirectory: string };
type LocalImport = { source: string; target: string };

export function buildRepositoryIndex(
  projectContext: ProjectContext,
  files: EvidenceFile[],
) {
  return {
    projectContext,
    pages: projectContext.relevantFiles.pages,
    layouts: files.filter((file) => /layout|shell|sidebar|header|footer/i.test(file.path)).map((file) => file.path),
    components: projectContext.relevantFiles.components,
    styles: projectContext.relevantFiles.styles,
    themes: projectContext.relevantFiles.themes,
    tokens: files.filter((file) => /token|theme|variable|tailwind/i.test(file.path) || /--[\w-]+\s*:/.test(file.content)).map((file) => file.path),
    animations: files.filter((file) => patterns.motion.test(`${file.path}\n${file.content}`)).map((file) => file.path),
    assets: files.filter((file) => /\.(?:svg|png|jpe?g|webp|gif|mp4|webm)$|\/(?:assets|public)\//i.test(file.path)).map((file) => file.path),
  };
}

export function selectEvidence(files: EvidenceFile[], specialist: Specialist) {
  const selection = inspectEvidenceSelection(files, specialist);
  const fileByPath = new Map(files.map((file) => [file.path, file]));

  return selection.selected.flatMap(({ path, charsIncluded }) => {
    const file = fileByPath.get(path);
    return file ? [{ path, content: file.content.slice(0, charsIncluded) }] : [];
  });
}

export function inspectEvidenceSelection(
  files: EvidenceFile[],
  specialist: Specialist,
): EvidenceSelection {
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const candidates = buildCandidates(files, specialist);
  let remaining = MAX_EVIDENCE_CHARS;
  const selected: Array<EvidenceCandidate & { charsIncluded: number }> = [];

  for (const candidate of candidates) {
    if (remaining <= 0) break;
    const file = fileByPath.get(candidate.path);
    if (!file) continue;

    const perFileLimit = specialist === 'components' || specialist === 'motion'
      ? MAX_FOCUSED_FILE_CHARS
      : remaining;
    const charsIncluded = Math.min(file.content.length, remaining, perFileLimit);
    remaining -= charsIncluded;
    selected.push({ ...candidate, charsIncluded });
  }

  return { candidates, selected };
}

function buildCandidates(files: EvidenceFile[], specialist: Specialist): EvidenceCandidate[] {
  if (specialist !== 'components' && specialist !== 'motion') {
    return files
      .filter((file) => patterns[specialist].test(`${file.path}\n${file.content}`))
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => ({
        path: file.path,
        score: 0,
        reasons: ['matches specialist routing pattern'],
        signals: [] as string[],
      }));
  }

  const imports = resolveLocalImports(files);
  const incomingImports = new Map<string, string[]>();
  for (const item of imports) {
    const importers = incomingImports.get(item.target) ?? [];
    importers.push(item.source);
    incomingImports.set(item.target, importers);
  }

  const seeds = files.filter((file) =>
    patterns[specialist].test(`${file.path}\n${file.content}`) ||
    (isRouteOrUsageFile(file.path) && imports.some((item) => item.source === file.path)),
  );
  const importedTargets = expandLocalImports(seeds.map((file) => file.path), imports);
  const candidatePaths = new Set([
    ...seeds.map((file) => file.path),
    ...importedTargets.keys(),
  ]);

  const signalDefinitions = specialist === 'components' ? componentSignals : motionSignals;
  const candidates: EvidenceCandidate[] = [];
  for (const path of candidatePaths) {
    const file = files.find((item) => item.path === path);
    if (!file) continue;

      const signals = signalDefinitions
        .filter(([, pattern]) => pattern.test(`${file.path}\n${file.content}`))
        .map(([name]) => name);
      const importers = incomingImports.get(path) ?? [];
      const importSources = importedTargets.get(path) ?? [];
      const componentDefinition = specialist === 'components' && isComponentDefinition(file.path, file.content);
      const motionImplementation = specialist === 'motion' && isMotionImplementation(file.path, signals);
      const reusableMotionComponent = specialist === 'motion' && isReusableMotionComponent(file.path);
      const namedMotionPrimitive = specialist === 'motion' && isNamedMotionPrimitive(file.path);
      const reasons = [
        ...(componentDefinition ? ['component/primitives implementation'] : []),
        ...(motionImplementation ? ['motion implementation'] : []),
        ...(importSources.length > 0
          ? [`resolved from local imports: ${importSources.slice(0, 3).join(', ')}`]
          : []),
        ...(importers.length > 0 ? [`used by ${importers.length.toString()} local file(s)`] : []),
        ...(signals.length > 0 ? [`signals: ${signals.join(', ')}`] : []),
      ];
      const score =
        signals.length * 10 +
        (componentDefinition ? 30 : 0) +
        (motionImplementation ? 20 : 0) +
        (reusableMotionComponent ? 50 : 0) +
        (namedMotionPrimitive ? 50 : 0) +
        Math.min(importers.length, 5) * 4 +
        (importSources.length > 0 ? 8 : 0);

    candidates.push({
      path,
      score,
      reasons: reasons.length > 0 ? reasons : ['local usage candidate'],
      signals,
    });
  }

  return candidates.sort(
    (left, right) => right.score - left.score || left.path.localeCompare(right.path),
  );
}

function isRouteOrUsageFile(path: string) {
  return /(?:^|\/)(?:app\/.*\/)?(?:page|route|layout|screen|index)\.[^.]+$|pages?\//i.test(path);
}

function isComponentDefinition(path: string, content: string) {
  return /(?:^|\/)(?:components?|ui|shared\/ui|design-system|primitives)(?:\/|$)/i.test(path) &&
    /\b(?:export\s+(?:default\s+)?(?:function|const|class)|function\s+\w+|const\s+\w+\s*=)/.test(content);
}

function isMotionImplementation(path: string, signals: string[]) {
  return signals.length > 0 &&
    (/(?:components?|ui|animated|motion|animation|loader|background)/i.test(path) ||
      signals.some((signal) => ['motion', 'AnimatePresence', 'keyframes', 'animation', 'tailwind animation'].includes(signal)));
}

function isReusableMotionComponent(path: string) {
  return /(?:^|\/)(?:components?|ui|shared\/ui|design-system|primitives)\//i.test(path);
}

function isNamedMotionPrimitive(path: string) {
  return /(?:animated|animation|aurora|border-beam|loader|motion|transition)/i.test(path);
}

function expandLocalImports(seedPaths: string[], imports: LocalImport[]) {
  const targets = new Map<string, string[]>();
  const queue = seedPaths.map((path) => ({ path, depth: 0 }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.path)) continue;
    visited.add(current.path);

    for (const item of imports.filter((entry) => entry.source === current.path)) {
      const sources = targets.get(item.target) ?? [];
      if (!sources.includes(current.path)) sources.push(current.path);
      targets.set(item.target, sources);

      if (current.depth < MAX_IMPORT_DEPTH) {
        queue.push({ path: item.target, depth: current.depth + 1 });
      }
    }
  }

  return targets;
}

function resolveLocalImports(files: EvidenceFile[]) {
  const paths = new Set(files.map((file) => file.path));
  const aliases = extractAliases(files);
  const imports: LocalImport[] = [];

  for (const file of files) {
    for (const specifier of extractImportSpecifiers(file.content)) {
      const target = resolveLocalImport(file.path, specifier, paths, aliases);
      if (target) imports.push({ source: file.path, target });
    }
  }

  return imports;
}

function extractImportSpecifiers(content: string) {
  return [...content.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => Boolean(specifier));
}

function extractAliases(files: EvidenceFile[]) {
  const aliases: Alias[] = [];

  for (const file of files.filter((item) => /(?:tsconfig|jsconfig)\.json$/i.test(item.path))) {
    try {
      const config = JSON.parse(stripJsonComments(file.content)) as {
        compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
      };
      const configDirectory = posix.dirname(file.path);
      const baseUrl = config.compilerOptions?.baseUrl ?? '.';
      for (const [prefix, targets] of Object.entries(config.compilerOptions?.paths ?? {})) {
        const target = targets.at(0);
        if (!target) continue;
        aliases.push({
          prefix: prefix.replace(/\*$/, ''),
          target: posix.normalize(posix.join(configDirectory, baseUrl, target.replace(/\*$/, ''))),
          configDirectory,
        });
      }
    } catch {
      // A malformed config should not prevent evidence routing for its snapshot.
    }
  }

  return aliases.sort((left, right) => right.configDirectory.length - left.configDirectory.length);
}

function stripJsonComments(content: string) {
  return content.replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/.*$/gm, '$1');
}

function resolveLocalImport(
  importer: string,
  specifier: string,
  paths: Set<string>,
  aliases: Alias[],
) {
  let unresolved: string | undefined;
  if (specifier.startsWith('.')) {
    unresolved = posix.normalize(posix.join(posix.dirname(importer), specifier));
  } else {
    const alias = aliases.find(
      (candidate) => importer.startsWith(`${candidate.configDirectory}/`) && specifier.startsWith(candidate.prefix),
    );
    if (!alias) return undefined;
    unresolved = posix.normalize(posix.join(alias.target, specifier.slice(alias.prefix.length)));
  }

  const normalized = unresolved.replaceAll('\\', '/');
  return importResolutionCandidates(normalized).find((candidate) => paths.has(candidate));
}

function importResolutionCandidates(path: string) {
  const extension = extname(path);
  const base = extension ? path.slice(0, -extension.length) : path;
  return [
    ...(extension ? [path] : []),
    ...IMPORT_EXTENSIONS.map((candidate) => `${base}${candidate}`),
    ...IMPORT_EXTENSIONS.map((candidate) => `${base}/index${candidate}`),
  ];
}

export function contextMetrics(files: EvidenceFile[]) {
  return { files: files.length, characters: files.reduce((total, file) => total + file.content.length, 0) };
}
