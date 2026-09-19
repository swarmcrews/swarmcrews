import type { ModelInfo } from "@github/copilot-sdk";
import type { HarnessModelInfo } from "../../../shared/harness-model.ts";

let availableModels: ReadonlyArray<HarnessModelInfo> = [];

export function normalizeCopilotModels(models: readonly ModelInfo[]): HarnessModelInfo[] {
  const seen = new Set<string>();
  return models.flatMap((model) => {
    if (!model.id?.trim() || seen.has(model.id)) return [];
    seen.add(model.id);
    const { supports, limits } = model.capabilities;
    return [{
      id: model.id, label: model.name || model.id, source: "dynamic" as const,
      supportsVision: supports.vision,
      supportsReasoning: supports.reasoningEffort,
      supportedEffortLevels: supports.reasoningEffort ? [...(model.supportedReasoningEfforts ?? [])] : [],
      ...(model.defaultReasoningEffort ? { defaultEffortLevel: model.defaultReasoningEffort } : {}),
      contextWindowTokens: limits.max_context_window_tokens,
      ...(limits.max_prompt_tokens !== undefined ? { maxPromptTokens: limits.max_prompt_tokens } : {}),
      ...(limits.vision ? { vision: {
        mediaTypes: [...limits.vision.supported_media_types],
        maxImages: limits.vision.max_prompt_images,
        maxImageBytes: limits.vision.max_prompt_image_size,
      } } : {}),
      ...(model.policy ? { policy: { ...model.policy } } : {}),
      ...(model.billing ? { billing: {
        ...(model.billing.multiplier !== undefined ? { multiplier: model.billing.multiplier } : {}), unit: "AI credits",
        ...(model.billing.tokenPrices ? { tokenPrices: { ...model.billing.tokenPrices } } : {}),
      } } : {}),
    }];
  });
}

export function setCopilotModels(models: readonly ModelInfo[]): void {
  availableModels = normalizeCopilotModels(models);
}

export function getCopilotModels(): ReadonlyArray<HarnessModelInfo> {
  return availableModels;
}

export function selectableCopilotModels(): ReadonlyArray<HarnessModelInfo> {
  return availableModels.filter((model) => model.policy?.state !== "disabled");
}
