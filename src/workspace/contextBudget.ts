export const DEFAULT_CHARS_PER_TOKEN = 4;
export const DEFAULT_HISTORY_TOKEN_BUDGET = 8_000;
export const DEFAULT_TURN_TOKEN_BUDGET = 1_500;
export const DEFAULT_COMPACTION_NOTICE =
  "[Earlier chat history was compacted to fit the local model context budget.]";
export const DEFAULT_TRIM_SUFFIX = "\n[Turn trimmed to fit the context budget.]";

export type ContextBudgetChatRole = "system" | "developer" | "user" | "assistant" | "tool";

export type ContextBudgetChatTurn = Readonly<{
  id?: string;
  role: ContextBudgetChatRole;
  content: string;
}>;

export type ChatTurnBudgetOptions = Readonly<{
  charsPerToken?: number;
  maxTokens?: number;
}>;

export type ChatTurnBudgetSummary = Readonly<{
  turn: ContextBudgetChatTurn;
  originalTokens: number;
  estimatedTokens: number;
  trimmed: boolean;
}>;

export type CompactRecentHistoryOptions = Readonly<{
  charsPerToken?: number;
  tokenBudget?: number;
  maxTokensPerTurn?: number;
  includeCompactionNotice?: boolean;
}>;

export type CompactRecentHistoryResult = Readonly<{
  turns: readonly ContextBudgetChatTurn[];
  originalEstimatedTokens: number;
  estimatedTokens: number;
  droppedTurnCount: number;
  trimmedTurnCount: number;
  compacted: boolean;
}>;

export type ContextCompactionDetectionInput = Readonly<{
  originalTurnCount: number;
  compactedTurnCount: number;
  droppedTurnCount?: number;
  trimmedTurnCount?: number;
}>;

export type ContextUsageEstimate = Readonly<{
  estimatedInputTokens: number;
  estimatedOutputTokens?: number;
  contextWindowTokens: number;
}>;

export function estimateTokenCountFromChars(
  characterCount: number,
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN,
): number {
  if (!Number.isFinite(characterCount) || characterCount <= 0) {
    return 0;
  }

  return Math.ceil(characterCount / positiveNumberOrDefault(charsPerToken, DEFAULT_CHARS_PER_TOKEN));
}

export function summarizeChatTurnForBudget(
  turn: ContextBudgetChatTurn,
  options: ChatTurnBudgetOptions = {},
): ChatTurnBudgetSummary {
  const charsPerToken = positiveNumberOrDefault(options.charsPerToken, DEFAULT_CHARS_PER_TOKEN);
  const originalTokens = estimateTokenCountFromChars(turn.content.length, charsPerToken);
  const maxTokens = positiveIntegerOrDefault(options.maxTokens, originalTokens);
  const maxChars = maxTokens * charsPerToken;
  const trimmedContent = trimTextToCharBudget(turn.content, maxChars);
  const budgetedTurn = { ...turn, content: trimmedContent.content };

  return {
    turn: budgetedTurn,
    originalTokens,
    estimatedTokens: estimateTokenCountFromChars(budgetedTurn.content.length, charsPerToken),
    trimmed: trimmedContent.trimmed,
  };
}

export function buildCompactRecentHistory(
  turns: readonly ContextBudgetChatTurn[],
  options: CompactRecentHistoryOptions = {},
): CompactRecentHistoryResult {
  const charsPerToken = positiveNumberOrDefault(options.charsPerToken, DEFAULT_CHARS_PER_TOKEN);
  const tokenBudget = positiveIntegerOrDefault(options.tokenBudget, DEFAULT_HISTORY_TOKEN_BUDGET);
  const maxTokensPerTurn = positiveIntegerOrDefault(options.maxTokensPerTurn, DEFAULT_TURN_TOKEN_BUDGET);
  const originalEstimatedTokens = sumEstimatedTokens(turns, charsPerToken);
  const noticeTokens = estimateTokenCountFromChars(DEFAULT_COMPACTION_NOTICE.length, charsPerToken);
  const shouldReserveNotice = (options.includeCompactionNotice ?? true) && originalEstimatedTokens > tokenBudget && noticeTokens < tokenBudget;
  const summaries = collectRecentTurnSummaries(turns, shouldReserveNotice ? tokenBudget - noticeTokens : tokenBudget, maxTokensPerTurn, charsPerToken);
  const droppedTurnCount = turns.length - summaries.length;
  const trimmedTurnCount = summaries.filter((summary) => summary.trimmed).length;
  const compacted = didCompactHistory({ originalTurnCount: turns.length, compactedTurnCount: summaries.length, droppedTurnCount, trimmedTurnCount });
  const historyTurns = summaries.map((summary) => summary.turn);
  const turnsWithNotice = compacted && shouldReserveNotice ? [compactionNoticeTurn(), ...historyTurns] : historyTurns;

  return {
    turns: turnsWithNotice,
    originalEstimatedTokens,
    estimatedTokens: sumEstimatedTokens(turnsWithNotice, charsPerToken),
    droppedTurnCount,
    trimmedTurnCount,
    compacted,
  };
}

export function didCompactHistory(input: ContextCompactionDetectionInput): boolean {
  return (
    input.compactedTurnCount < input.originalTurnCount ||
    (input.droppedTurnCount ?? 0) > 0 ||
    (input.trimmedTurnCount ?? 0) > 0
  );
}

export function computeContextUsagePercent(input: ContextUsageEstimate): number {
  const contextWindowTokens = positiveNumberOrDefault(input.contextWindowTokens, 0);

  if (contextWindowTokens === 0) {
    return 0;
  }

  const usedTokens = nonNegativeNumber(input.estimatedInputTokens) + nonNegativeNumber(input.estimatedOutputTokens ?? 0);
  const percent = (usedTokens / contextWindowTokens) * 100;
  return Math.min(100, Math.round(percent * 10) / 10);
}

function collectRecentTurnSummaries(
  turns: readonly ContextBudgetChatTurn[],
  tokenBudget: number,
  maxTokensPerTurn: number,
  charsPerToken: number,
): readonly ChatTurnBudgetSummary[] {
  const summaries: ChatTurnBudgetSummary[] = [];
  let remainingTokens = tokenBudget;

  for (let index = turns.length - 1; index >= 0 && remainingTokens > 0; index -= 1) {
    const maxTokens = Math.min(maxTokensPerTurn, remainingTokens);
    const summary = summarizeChatTurnForBudget(turns[index], { charsPerToken, maxTokens });
    summaries.unshift(summary);
    remainingTokens -= summary.estimatedTokens;

    if (summary.trimmed) {
      break;
    }
  }

  return summaries;
}

function sumEstimatedTokens(turns: readonly ContextBudgetChatTurn[], charsPerToken: number): number {
  return turns.reduce(
    (totalTokens, turn) => totalTokens + estimateTokenCountFromChars(turn.content.length, charsPerToken),
    0,
  );
}

function trimTextToCharBudget(text: string, maxChars: number): Readonly<{ content: string; trimmed: boolean }> {
  if (text.length <= maxChars) {
    return { content: text, trimmed: false };
  }

  if (maxChars <= DEFAULT_TRIM_SUFFIX.length) {
    return { content: text.slice(0, Math.max(0, maxChars)).trimEnd(), trimmed: true };
  }

  return {
    content: `${text.slice(0, maxChars - DEFAULT_TRIM_SUFFIX.length).trimEnd()}${DEFAULT_TRIM_SUFFIX}`,
    trimmed: true,
  };
}

function compactionNoticeTurn(): ContextBudgetChatTurn {
  return {
    id: "context-compaction-notice",
    role: "system",
    content: DEFAULT_COMPACTION_NOTICE,
  };
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function positiveNumberOrDefault(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return fallback;
  }

  return value;
}

function nonNegativeNumber(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value;
}
