/** Conservative local estimator. The 20k hard cap is estimated, not an exact Gemini tokenizer count. */
export const TOKEN_BUDGET_MODE = 'conservative-estimate' as const;
export const TARGET_TOKENS = 12_000;
export const HARD_CAP_TOKENS = 20_000;

export function estimateTokens(text: string): number {
  return Math.ceil(Math.max(text.length, 1) / 3);
}
