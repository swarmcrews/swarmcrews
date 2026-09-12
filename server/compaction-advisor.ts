import type { NormalizedEvent } from "../shared/normalized-event.ts";

export const RECOMMEND_THRESHOLD = 0.55;
export const FORCE_THRESHOLD = 0.8;
export const DEFAULT_LARGE_CONTEXT_WINDOW_TOKENS = 1_000_000;
export const FALLBACK_CONTEXT_WINDOW_TOKENS = 200_000;

export type ProactiveCompactionSetting = "off" | "recommend" | "auto";
export const DEFAULT_PROACTIVE_COMPACTION: ProactiveCompactionSetting = "recommend";

export type CompactionAction = "none" | "recommend" | "force";

export interface CompactionAdvisorState {
  recommendedArmed: boolean;
  forcedArmed: boolean;
}

export interface CompactionAdvice {
  action: CompactionAction;
  contextTokens: number;
  contextWindowTokens: number;
  ratio: number;
}

export function initialCompactionAdvisorState(): CompactionAdvisorState {
  return { recommendedArmed: false, forcedArmed: false };
}

export function contextWindowForModel(model: string | null | undefined): number {
  const normalized = (model ?? "").toLowerCase();
  if (
    normalized.includes("opus") ||
    normalized.includes("fable") ||
    normalized.includes("gpt-5") ||
    normalized.includes("gpt-6")
  ) {
    return DEFAULT_LARGE_CONTEXT_WINDOW_TOKENS;
  }
  return FALLBACK_CONTEXT_WINDOW_TOKENS;
}

export function promptContextTokens(
  usage: Extract<NormalizedEvent, { kind: "usage" }>,
): number | null {
  // Billing totals (including Codex turn.completed and Claude result) do not
  // measure context occupancy. Unknown occupancy must not trigger a reset.
  return usage.contextTokens != null && Number.isFinite(usage.contextTokens) && usage.contextTokens >= 0
    ? usage.contextTokens : null;
}

export function evaluateCompactionUsage(
  state: CompactionAdvisorState,
  usage: Extract<NormalizedEvent, { kind: "usage" }>,
  model: string | null | undefined,
): CompactionAdvice | null {
  const contextTokens = promptContextTokens(usage);
  if (contextTokens === null) return null;
  const contextWindowTokens = usage.contextWindowTokens ?? contextWindowForModel(model);
  if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) return null;
  const ratio = contextTokens / contextWindowTokens;
  let action: CompactionAction = "none";

  // Native provider compaction can lower occupancy without changing threads.
  if (ratio < RECOMMEND_THRESHOLD) state.recommendedArmed = false;
  if (ratio < FORCE_THRESHOLD) state.forcedArmed = false;

  if (ratio >= FORCE_THRESHOLD && !state.forcedArmed) {
    state.forcedArmed = true;
    state.recommendedArmed = true;
    action = "force";
  } else if (ratio >= RECOMMEND_THRESHOLD && !state.recommendedArmed) {
    state.recommendedArmed = true;
    action = "recommend";
  }

  return { action, contextTokens, contextWindowTokens, ratio };
}
