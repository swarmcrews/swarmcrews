import type { HarnessModelInfo } from "../../../shared/harness-model.ts";

const ANSI_ESCAPE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const PI_THINKING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export interface PiNativeModelMetadata {
  provider: string;
  id: string;
  reasoning?: boolean;
  thinkingLevelMap?: Partial<Record<"off" | typeof PI_THINKING_EFFORTS[number], string | null | undefined>>;
}

let availableModels: ReadonlyArray<HarnessModelInfo> = [];

/** Parse tab-separated or padded columns emitted by `pi --list-models`. */
export function parsePiModels(stdout: string): HarnessModelInfo[] {
  const models: HarnessModelInfo[] = [];
  const seen = new Set<string>();
  let imagesColumn = -1;
  let thinkingColumn = -1;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.replace(ANSI_ESCAPE, "").trim();
    if (!line || /^no models available/i.test(line)) continue;
    const columns = line.includes("\t") ? line.split("\t") : line.split(/\s{2,}/);
    const first = columns[0]?.trim() ?? "";
    const second = columns[1]?.trim() ?? "";
    if (/^provider$/i.test(first) && /^model/i.test(second)) {
      imagesColumn = columns.findIndex(column => /^images$/i.test(column.trim()));
      thinkingColumn = columns.findIndex(column => /^thinking$/i.test(column.trim()));
      continue;
    }
    const id = first.includes("/") ? first : first && second ? `${first}/${second}` : "";
    if (!id || !id.includes("/") || seen.has(id)) continue;
    seen.add(id);
    const displayName = columns[2]?.trim();
    const images = columns[imagesColumn]?.trim().toLowerCase();
    const thinking = columns[thinkingColumn]?.trim().toLowerCase();
    models.push({ id, label: displayName && !/^\d/.test(displayName) ? displayName : id,
      ...(images === "yes" || images === "no" ? { supportsVision: images === "yes" } : {}),
      ...(thinking === "yes" || thinking === "no" ? { supportsReasoning: thinking === "yes" } : {}) });
  }
  return models;
}

/**
 * Apply Pi's native model metadata to the intentionally terse CLI catalog.
 * Pi's `--list-models` exposes only a yes/no thinking column; native metadata
 * is the authority for individual levels.
 */
export function applyPiNativeMetadata(
  models: ReadonlyArray<HarnessModelInfo>,
  nativeModels: ReadonlyArray<PiNativeModelMetadata>,
): HarnessModelInfo[] {
  const nativeById = new Map(nativeModels.map(model => [`${model.provider}/${model.id}`, model]));
  return models.map(model => {
    const native = nativeById.get(model.id);
    if (!native) return { ...model, source: "dynamic" };
    const supportedEffortLevels = native.reasoning
      ? PI_THINKING_EFFORTS.filter(level => {
        const mapped = native.thinkingLevelMap?.[level];
        return level === "xhigh" || level === "max" ? mapped !== undefined && mapped !== null : mapped !== null;
      })
      : [];
    return { ...model, source: "dynamic", supportsReasoning: Boolean(native.reasoning), supportedEffortLevels };
  });
}

export function setPiModels(models: ReadonlyArray<HarnessModelInfo>): void {
  availableModels = [...models];
}

export function getPiModels(): ReadonlyArray<HarnessModelInfo> {
  return availableModels;
}

export function resolvePiModel(model: string | null | undefined): string | null {
  return model?.trim() || null;
}
