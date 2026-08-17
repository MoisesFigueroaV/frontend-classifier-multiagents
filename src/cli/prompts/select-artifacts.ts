import type { Interface } from 'node:readline/promises';

import type { ArtifactKind } from '../artifacts/artifact-types';

const choices = `\n¿Qué artefactos deseas generar?\n  1. classification.json\n  2. UI_SKILL.md\n  3. design-report.md\n  4. Todos\n> `;

export async function selectArtifacts(readline: Interface): Promise<ArtifactKind[]> {
  while (true) {
    const answer = (await readline.question(choices)).trim().toLowerCase();
    if (answer === '1' || answer === 'classification.json') return ['classification'];
    if (answer === '2' || answer === 'ui_skill.md' || answer === 'ui skill') return ['uiSkill'];
    if (answer === '3' || answer === 'design-report.md' || answer === 'design report') return ['designReport'];
    if (answer === '4' || answer === 'todos' || answer === 'all') {
      return ['classification', 'uiSkill', 'designReport'];
    }
  }
}
