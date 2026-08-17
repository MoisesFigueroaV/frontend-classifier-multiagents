import type { RequestContext } from '@mastra/core/request-context';

export const TOKEN_USAGE_CONTEXT_KEY = 'frontend-analysis.token-usage';

export type AnalysisAgentName =
  | 'visual-style'
  | 'components'
  | 'layout'
  | 'motion'
  | 'classification';

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  cacheMissInputTokens?: number;
  cacheCreationInputTokens?: number;
};

export type TokenUsageSummary = Partial<Record<AnalysisAgentName, TokenUsage>>;

type UsageCarrier = {
  usage?: unknown;
};

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function tokenValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = numberValue(record[key]);
    if (value !== undefined) return value;
  }
  return 0;
}

export function readTokenUsage(result: UsageCarrier): TokenUsage {
  const usage =
    result.usage && typeof result.usage === 'object'
      ? (result.usage as Record<string, unknown>)
      : {};
  const inputTokens = tokenValue(usage, 'inputTokens', 'promptTokens');
  const outputTokens = tokenValue(usage, 'outputTokens', 'completionTokens');
  const reasoningTokens = tokenValue(usage, 'reasoningTokens');
  const totalTokens = tokenValue(usage, 'totalTokens') || inputTokens + outputTokens;
  const cachedInputTokens = numberValue(usage.cachedInputTokens);
  const cacheMissInputTokens =
    cachedInputTokens === undefined
      ? undefined
      : Math.max(0, inputTokens - cachedInputTokens);
  const cacheCreationInputTokens = numberValue(usage.cacheCreationInputTokens);

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(cacheMissInputTokens === undefined ? {} : { cacheMissInputTokens }),
    ...(cacheCreationInputTokens === undefined
      ? {}
      : { cacheCreationInputTokens }),
  };
}

function formatOptionalTokens(label: string, value: number | undefined) {
  return value === undefined ? '' : ` / ${label} ${value.toString()}`;
}

export function recordTokenUsage(
  requestContext: RequestContext,
  agent: AnalysisAgentName,
  result: UsageCarrier,
) {
  const usage = readTokenUsage(result);
  const existing = requestContext.get(TOKEN_USAGE_CONTEXT_KEY);
  const summary: TokenUsageSummary =
    existing && typeof existing === 'object'
      ? (existing as TokenUsageSummary)
      : {};

  summary[agent] = usage;
  requestContext.set(TOKEN_USAGE_CONTEXT_KEY, summary);

  console.info(
    `[frontend-analysis] ${agent} tokens: input ${usage.inputTokens.toString()} / reasoning ${usage.reasoningTokens.toString()} / output ${usage.outputTokens.toString()} / total ${usage.totalTokens.toString()}${formatOptionalTokens('cache hit', usage.cachedInputTokens)}${formatOptionalTokens('cache miss', usage.cacheMissInputTokens)}${formatOptionalTokens('cache write', usage.cacheCreationInputTokens)}`,
  );
}

export function getTokenUsageSummary(requestContext: RequestContext) {
  const value = requestContext.get(TOKEN_USAGE_CONTEXT_KEY);
  return value && typeof value === 'object' ? (value as TokenUsageSummary) : {};
}

export function formatTokenUsageSummary(summary: TokenUsageSummary) {
  const labels: Array<[AnalysisAgentName, string]> = [
    ['visual-style', 'Visual'],
    ['components', 'Components'],
    ['layout', 'Layout'],
    ['motion', 'Motion'],
    ['classification', 'Classification'],
  ];
  const total = labels.reduce(
    (sum, [agent]) => sum + (summary[agent]?.totalTokens ?? 0),
    0,
  );
  const line = '-'.repeat(57);
  const rows = labels.map(([agent, label]) => {
    const usage = summary[agent];
    return `${label.padEnd(15)} input ${(usage?.inputTokens ?? 0).toString()} / reasoning ${(usage?.reasoningTokens ?? 0).toString()} / output ${(usage?.outputTokens ?? 0).toString()} / total ${(usage?.totalTokens ?? 0).toString()}${formatOptionalTokens('cache hit', usage?.cachedInputTokens)}${formatOptionalTokens('cache miss', usage?.cacheMissInputTokens)}`;
  });

  return ['Token usage:', ...rows, line, `Total: ${total.toString()}`].join('\n');
}
