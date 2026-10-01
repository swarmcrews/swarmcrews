import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import type { HarnessModelInfo } from "../../../shared/harness-model.ts";
import { modelVersionLabel } from "../model-label.ts";

let availableModels: HarnessModelInfo[] = [];
let nativeModels: ReadonlyArray<ModelInfo> = [];

export function setClaudeModels(models: ReadonlyArray<ModelInfo>): void {
  nativeModels = models.filter(model => model && typeof model.value === "string" && model.value.trim());
  const seen = new Set<string>();
  availableModels = nativeModels.flatMap(model => {
    const id = nativeModelId(model);
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, label: modelVersionLabel(id, model.displayName), source: "dynamic" as const,
      ...(model.description ? { description: model.description } : {}),
      ...(model.supportedEffortLevels ? { supportedEffortLevels: [...model.supportedEffortLevels] } : {}),
    }];
  });
}

export function getClaudeModels(): ReadonlyArray<HarnessModelInfo> { return availableModels; }

function nativeModelId(model: ModelInfo): string {
  // Keep context-window modifiers even when resolvedModel reports only a base ID.
  const suffix = model.value.match(/\[[^\]]+\]$/)?.[0] ?? "";
  return model.resolvedModel ? model.resolvedModel + (model.resolvedModel.endsWith(suffix) ? "" : suffix) : model.value;
}

/**
 * Claude model alias resolution.
 *
 * Maps short UI aliases ("opus", "sonnet") to concrete Anthropic model IDs.
 * Native aliases take precedence. Session-host-run.ts delegates to harness.resolveModel(),
 * which calls resolveModelAlias() here. No duplicate table elsewhere.
 */

/**
 * Short aliases the UI accepts, mapped to their full Anthropic model IDs.
 * Used only when discovery does not supply an alias; never a picker catalog.
 */
const MODEL_ALIAS_MAP: Record<string, string> = {
  fable: "claude-fable-5-1",
  "opus-5": "claude-opus-5",
  opus: "claude-opus-4-8",
  "opus-old": "claude-opus-4-7",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
};

export const CLAUDE_MODEL_POLICY = {
  leader: ["claude-opus-5", "claude-opus-4-8", "claude-fable-5-1", "claude-fable-5", "claude-sonnet-5", "claude-opus-4-7", "claude-haiku-4-5"],
  minion: {
    mechanical: ["claude-haiku-4-5", "claude-sonnet-5", "claude-fable-5-1", "claude-fable-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7"],
    standard: ["claude-sonnet-5", "claude-fable-5-1", "claude-fable-5", "claude-haiku-4-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7"],
    reasoning: ["claude-opus-5", "claude-opus-4-8", "claude-fable-5-1", "claude-fable-5", "claude-sonnet-5", "claude-opus-4-7", "claude-haiku-4-5"],
  },
} as const;

/**
 * Resolve a user-supplied alias or concrete model ID to a canonical model ID.
 *
 * - Known aliases are expanded to their full ID.
 * - Strings not in the alias map are returned as-is (treated as concrete IDs).
 * - Null / empty input returns null.
 */
export function resolveModelAlias(alias: string | null | undefined): string | null {
  if (!alias) return null;
  const native = nativeModels.find(model => model.value === alias || model.resolvedModel === alias
    || nativeModelId(model) === alias || model.resolvedModel?.replace(/\[[^\]]+\]$/, "") === alias);
  return native ? nativeModelId(native) : MODEL_ALIAS_MAP[alias] ?? alias;
}

/**
 * Return true if `model` is known to support adaptive thinking.
 * Keep this aligned with the adaptive-thinking validation in
 * session-host-config.ts.
 */
const ADAPTIVE_THINKING_MODELS: ReadonlySet<string> = new Set([
  "sonnet",
  "fable",
  "opus",
  "opus-5",
  "opus-old",
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-5",
  "claude-mythos-preview",
]);

export function supportsAdaptiveThinking(model: string | null | undefined): boolean {
  if (!model) return false;
  const native = nativeModels.find(entry => entry.value === model || entry.resolvedModel === model || nativeModelId(entry) === model);
  return native?.supportsAdaptiveThinking ?? ADAPTIVE_THINKING_MODELS.has(model);
}
