import type { ProjectContext } from '../schemas/project-context';

export type EvidenceFile = { path: string; content: string };
export type Specialist = 'visual' | 'components' | 'layout' | 'motion';

const MAX_EVIDENCE_CHARS = 12_000;

const patterns: Record<Specialist, RegExp> = {
  visual: /\.(?:css|scss|sass|less)$|theme|token|variable|color|font|tailwind/i,
  components: /component|\/(?:ui|widgets?)\/|className|styled\(|variant/i,
  layout: /page|route|layout|screen|grid|container|sidebar|header|footer/i,
  motion: /animation|transition|keyframes|framer-motion|\bmotion\b|\bgsap\b|animate-|duration-|ease-/i,
};

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
  const selected = files
    .filter((file) => patterns[specialist].test(`${file.path}\n${file.content}`))
    .sort((left, right) => left.path.localeCompare(right.path));
  const candidates = selected.length > 0 ? selected : files;
  let remaining = MAX_EVIDENCE_CHARS;
  return candidates.flatMap((file) => {
    if (remaining <= 0) return [];
    const content = file.content.slice(0, remaining);
    remaining -= content.length;
    return [{ path: file.path, content }];
  });
}

export function contextMetrics(files: EvidenceFile[]) {
  return { files: files.length, characters: files.reduce((total, file) => total + file.content.length, 0) };
}
