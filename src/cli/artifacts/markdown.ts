export function bulletList(values: string[]) {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : '- No identificado.';
}

export function evidenceList(
  evidence: Array<{ observation: string; sources: string[] }>,
) {
  return evidence.length > 0
    ? evidence
        .map(
          ({ observation, sources }) =>
            `- ${observation}\n  - Fuentes: ${sources.map((source) => `\`${source}\``).join(', ')}`,
        )
        .join('\n')
    : '- No se registró evidencia.';
}

export function heading(title: string, content: string) {
  return `## ${title}\n\n${content}`;
}
