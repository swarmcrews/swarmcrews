import type { HarnessModelInfo } from "../../../shared/harness-model.ts";
import { modelVersionLabel } from "../model-label.ts";

let availableModels: HarnessModelInfo[] = [];
let nativeDefault: string | undefined;

export function setCodexModels(models: readonly unknown[]): void {
  const seen = new Set<string>();
  nativeDefault = undefined;
  availableModels = models.flatMap(raw => {
    if (!raw || typeof raw !== "object") return [];
    const model = raw as Record<string, unknown>;
    // `id` is a picker row identifier; `model` is the value accepted at launch.
    if (model.hidden === true || typeof model.model !== "string" || !model.model.trim() || seen.has(model.model)) return [];
    const id = model.model;
    seen.add(id);
    if (model.isDefault === true) nativeDefault = id;
    // model/list advertises objects, not strings. Preserve native choices so
    // dynamic-model capability gates can offer and forward reasoning effort.
    const supportedEffortLevels = Array.isArray(model.supportedReasoningEfforts)
      ? [...new Set(model.supportedReasoningEfforts.flatMap((option: unknown) => {
        if (!option || typeof option !== "object") return [];
        const effort = (option as Record<string, unknown>).reasoningEffort;
        return typeof effort === "string" && effort.trim() ? [effort] : [];
      }))]
      : undefined;
    return [{ id, label: modelVersionLabel(id, typeof model.displayName === "string" ? model.displayName : undefined),
      source: "dynamic" as const,
      ...(supportedEffortLevels !== undefined ? { supportedEffortLevels, supportsReasoning: supportedEffortLevels.length > 0 } : {}),
      ...(typeof model.defaultReasoningEffort === "string" && supportedEffortLevels?.includes(model.defaultReasoningEffort)
        ? { defaultEffortLevel: model.defaultReasoningEffort } : {}),
      ...(typeof model.description === "string" && model.description ? { description: model.description } : {}),
    }];
  });
}

export function getCodexModels(): ReadonlyArray<HarnessModelInfo> { return availableModels; }

/**
 * Codex model alias resolution.
 *
 * Maps short UI aliases ("codex", "fast", "default") to canonical OpenAI
 * model IDs. Mirrors the pattern in server/harness/claude/models.ts.
 */

/**
 * Role-routing preferences and offline alias resolution, not a picker catalog.
 *
 * GPT-6 Astra is the flagship for the hardest end-to-end work. GPT-5.6
 * remains a three-tier model family whose tier names describe the durable
 * capability/cost tradeoff:
 *   - Sol   — strongest GPT-5.6 tier  (`gpt-5.6-sol`)
 *   - Terra — strong lower-cost mid   (`gpt-5.6-terra`)
 *   - Luna  — fastest / cheapest      (`gpt-5.6-luna`)
 * The bare `gpt-5.6` generation alias continues to route to Sol. Older
 * explicit IDs (`gpt-5`, `gpt-5.5`, `gpt-5.3-codex-spark`, …) resolve
 * forward to the nearest current GPT-5.6 tier.
 */
export const CODEX_ASTRA_MODEL_ID = "gpt-6-astra";
export const CODEX_SOL_MODEL_ID = "gpt-5.6-sol";
export const CODEX_TERRA_MODEL_ID = "gpt-5.6-terra";
export const CODEX_LUNA_MODEL_ID = "gpt-5.6-luna";

/** The current flagship is the default when a caller asks for Codex. */
export const CODEX_DEFAULT_MODEL_ID = CODEX_ASTRA_MODEL_ID;

export const CODEX_MODEL_POLICY = {
  leader: [
    CODEX_ASTRA_MODEL_ID,
    CODEX_SOL_MODEL_ID,
    CODEX_TERRA_MODEL_ID,
    CODEX_LUNA_MODEL_ID,
  ],
  minion: {
    mechanical: [
      CODEX_LUNA_MODEL_ID,
      CODEX_TERRA_MODEL_ID,
      CODEX_SOL_MODEL_ID,
      CODEX_ASTRA_MODEL_ID,
    ],
    standard: [
      CODEX_TERRA_MODEL_ID,
      CODEX_LUNA_MODEL_ID,
      CODEX_SOL_MODEL_ID,
      CODEX_ASTRA_MODEL_ID,
    ],
    reasoning: [
      CODEX_ASTRA_MODEL_ID,
      CODEX_SOL_MODEL_ID,
      CODEX_TERRA_MODEL_ID,
      CODEX_LUNA_MODEL_ID,
    ],
  },
} as const;

/**
 * Short aliases the Codex harness accepts, mapped to canonical model IDs.
 * Lookup is done after lowercasing the input, so aliases are case-insensitive.
 */
const CODEX_MODEL_ALIAS_MAP: Record<string, string> = {
  // Canonical model IDs (identity).
  [CODEX_ASTRA_MODEL_ID]: CODEX_ASTRA_MODEL_ID,
  [CODEX_SOL_MODEL_ID]: CODEX_SOL_MODEL_ID,
  [CODEX_TERRA_MODEL_ID]: CODEX_TERRA_MODEL_ID,
  [CODEX_LUNA_MODEL_ID]: CODEX_LUNA_MODEL_ID,
  // Bare generation alias routes to the flagship tier (OpenAI routing).
  "gpt-5.6": CODEX_SOL_MODEL_ID,
  // Short harness aliases.
  codex: CODEX_DEFAULT_MODEL_ID,
  default: CODEX_DEFAULT_MODEL_ID,
  "codex-default": CODEX_DEFAULT_MODEL_ID,
  fast: CODEX_LUNA_MODEL_ID,
  // Legacy persisted IDs resolve forward to the nearest current tier.
  "gpt-5.5": CODEX_SOL_MODEL_ID,
  "gpt-5.4": CODEX_TERRA_MODEL_ID,
  "gpt-5.3-codex-spark": CODEX_LUNA_MODEL_ID,
  "gpt-5": CODEX_SOL_MODEL_ID,
  "gpt-5-codex": CODEX_SOL_MODEL_ID,
  "gpt-5-codex-mini": CODEX_LUNA_MODEL_ID,
};

/**
 * Resolve a user-supplied alias or concrete model ID to a canonical Codex model ID.
 *
 * - Known aliases (case-insensitive) are expanded to current Codex model IDs.
 *   Old persisted IDs are treated as compatibility aliases.
 * - Strings not in the alias map are returned as-is (treated as concrete IDs).
 * - Null / empty input returns null.
 */
export function resolveCodexModel(alias: string | null | undefined): string | null {
  if (!alias) return null;
  const advertised = availableModels.find(model => model.id.toLowerCase() === alias.toLowerCase());
  if (advertised) return advertised.id;
  if (nativeDefault && ["codex", "default", "codex-default"].includes(alias.toLowerCase())) return nativeDefault;
  return CODEX_MODEL_ALIAS_MAP[alias.toLowerCase()] ?? alias;
}
