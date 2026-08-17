import type { MastraModelConfig } from '@mastra/core/llm';

type AIProvider = 'deepseek' | 'google';

const configuredProvider = process.env.AI_PROVIDER ?? 'google';

if (configuredProvider !== 'google' && configuredProvider !== 'deepseek') {
  throw new Error(
    `Unsupported AI_PROVIDER: ${configuredProvider}. Use "google" or "deepseek".`,
  );
}

export const aiProvider = configuredProvider as AIProvider;

export const agentModel: MastraModelConfig =
  aiProvider === 'deepseek'
    ? (`deepseek/${process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'}` as `${string}/${string}`)
    : (`google/${process.env.GOOGLE_MODEL ?? 'gemini-3.5-flash'}` as `${string}/${string}`);

export const usesGoogleNativeTools = aiProvider === 'google';
