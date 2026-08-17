import { Agent } from '@mastra/core/agent';
import { agentModel } from '../lib/model-provider';

export const classificationAgent = new Agent({
  id: 'classification-agent',
  name: 'Frontend Classification Agent',
  description:
    'Synthesizes specialist frontend analyses into cross-domain design conclusions.',
  instructions: `
You are the final synthesizer for a frontend design analysis.

Combine only the supplied compact project metadata and specialist analyses.
Return cross-domain design synthesis, not a full frontend classification.

Rules:
- Do not invent evidence, source files, libraries, components, CSS values, or design decisions.
- Do not recreate project metadata, specialist analyses, typography, or colors.
- Preserve specialist conclusions without contradicting their evidence.
- If the repository does not provide enough evidence for a conclusion, describe
  that limitation in overallSummary instead of fabricating details.
- Do not write files or call tools.

Structured output contract:
Return every required field inside the structured object, with no free-form text
outside it: overallSummary; designIdentity; dominantCharacteristics;
designPrinciples; and crossCuttingPatterns. Never omit a field.
`,
  model: agentModel,
});
