import type { HarnessModelInfo } from "../../shared/harness-model.ts";

/** Display-only inventory. Never consult this cache for readiness or launch validation. */
const MAX_HARNESSES = 8;
const MAX_MODELS = 256;
const DISPLAY_TTL_MS = 10 * 60_000;
const display = new Map<string, { models: ReadonlyArray<HarnessModelInfo>; expires: number }>();

export function displayModels(name: string, live: ReadonlyArray<HarnessModelInfo>): ReadonlyArray<HarnessModelInfo> {
  const previous = display.get(name);
  if (previous && previous.expires <= Date.now()) display.delete(name);
  return live.length ? live.slice(0, MAX_MODELS) : display.get(name)?.models ?? [];
}

export function rememberDisplayModels(name: string, models: ReadonlyArray<HarnessModelInfo>): void {
  if (!models.length) return; // An empty/failed native probe cannot erase display history.
  display.delete(name);
  display.set(name, { models: models.slice(0, MAX_MODELS).map(model => ({ ...model })), expires: Date.now() + DISPLAY_TTL_MS });
  if (display.size > MAX_HARNESSES) display.delete(display.keys().next().value!);
}

export function clearDisplayModels(): void { display.clear(); }
