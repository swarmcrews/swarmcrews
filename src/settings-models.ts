import type { EffortLevel, ThinkingConfig } from "./types.ts";
import type { HarnessInfo } from "./harness-list.ts";
import { getModelCapability } from "./model-meta.ts";

// ── Model settings helpers ─────────────────────────────────

export interface ModelGroup {
  harness: string;
  label: string;
  options: Array<{ value: string; label: string; model: string; harness: string }>;
}

const FALLBACK_MODEL_GROUPS: ModelGroup[] = [
  {
    harness: "claude",
    label: "Anthropic",
    options: [
      {
        value: "claude::claude-opus-5",
        label: "Opus 5",
        model: "claude-opus-5",
        harness: "claude",
      },
      {
        value: "claude::claude-fable-5-1",
        label: "Fable 5.1",
        model: "claude-fable-5-1",
        harness: "claude",
      },
      {
        value: "claude::claude-fable-5",
        label: "Fable 5",
        model: "claude-fable-5",
        harness: "claude",
      },
      {
        value: "claude::claude-opus-4-8",
        label: "Opus 4.8",
        model: "claude-opus-4-8",
        harness: "claude",
      },
      {
        value: "claude::claude-opus-4-7",
        label: "Opus 4.7",
        model: "claude-opus-4-7",
        harness: "claude",
      },
      {
        value: "claude::claude-sonnet-5",
        label: "Sonnet 5",
        model: "claude-sonnet-5",
        harness: "claude",
      },
      {
        value: "claude::claude-haiku-4-5",
        label: "Haiku 4.5",
        model: "claude-haiku-4-5",
        harness: "claude",
      },
    ],
  },
];

const LEGACY_MODEL_ALIASES: Record<string, string> = {
  fable: "claude-fable-5-1",
  "opus-5": "claude-opus-5",
  opus: "claude-opus-4-8",
  "opus-old": "claude-opus-4-7",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
  "gpt-5": "gpt-5.6-sol",
  "gpt-5-codex": "gpt-5.6-sol",
  "gpt-5.6": "gpt-5.6-sol",
  "gpt-5.5": "gpt-5.6-sol",
  "gpt-5.4": "gpt-5.6-terra",
  "gpt-5.3-codex-spark": "gpt-5.6-luna",
};

export function buildModelGroups(
  harnesses: ReadonlyArray<HarnessInfo>,
  loaded: boolean,
): ModelGroup[] {
  if (!loaded || harnesses.length === 0) return FALLBACK_MODEL_GROUPS;
  return harnesses
    .filter((h) => h.models.length > 0)
    .map((h) => {
      const label = providerLabel(h);
      return {
        harness: h.name,
        label,
        options: h.models.map((m) => ({
          value: `${h.name}::${m.id}`,
          label: `${m.label} (${label})`,
          model: m.id,
          harness: h.name,
        })),
      };
    });
}

function providerLabel(harness: HarnessInfo): string {
  const provider = String(harness.account.provider ?? harness.name).toLowerCase();
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic" || provider === "claude") return "Anthropic";
  if (provider === "echo") return "Echo";
  return harness.name.charAt(0).toUpperCase() + harness.name.slice(1);
}

export function resolveModelSelection(
  preferredHarness: string,
  model: string,
  groups: ModelGroup[],
): { value: string; harness: string; model: string } {
  const canonicalModel = LEGACY_MODEL_ALIASES[model] ?? model;
  const exact = findModelOption(groups, preferredHarness, canonicalModel);
  if (exact) return exact;

  const anyHarnessExact = groups
    .flatMap((g) => g.options)
    .find((o) => o.model === canonicalModel);
  if (anyHarnessExact) return anyHarnessExact;

  const preferredDefault = groups.find((g) => g.harness === preferredHarness)?.options[0];
  const fallback = preferredDefault ?? groups[0]?.options[0] ?? FALLBACK_MODEL_GROUPS[0]!.options[0]!;
  return fallback;
}

function findModelOption(
  groups: ModelGroup[],
  harness: string,
  model: string,
): { value: string; harness: string; model: string } | undefined {
  return groups
    .find((g) => g.harness === harness)
    ?.options.find((o) => o.model === model);
}

export function normalizeThinkingConfig(
  value: unknown,
  fallback: ThinkingConfig,
): ThinkingConfig {
  if (typeof value !== "object" || value === null) return { ...fallback };
  const cfg = value as Partial<Record<keyof ThinkingConfig, unknown>>;
  const enabled = typeof cfg.enabled === "boolean" ? cfg.enabled : fallback.enabled;
  const effort = isEffortLevel(cfg.effort) ? cfg.effort : fallback.effort;
  const display =
    cfg.display === "summarized" || cfg.display === "omitted"
      ? cfg.display
      : fallback.display;
  return { enabled, effort, display };
}

export function normalizeThinkingForCapability(
  config: ThinkingConfig,
  capability: ReturnType<typeof getModelCapability>,
): ThinkingConfig {
  if (!capability.supportsAdaptiveThinking) return { ...config, enabled: false };
  if (capability.supportedEffortLevels.includes(config.effort)) return { ...config };
  return {
    ...config,
    effort: capability.supportedEffortLevels.includes("high")
      ? "high"
      : (capability.supportedEffortLevels[0] ?? config.effort),
  };
}

function isEffortLevel(value: unknown): value is EffortLevel {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}
