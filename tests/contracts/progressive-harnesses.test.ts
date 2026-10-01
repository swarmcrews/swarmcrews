import { describe, expect, it } from "vitest";
import { mergeHarnessCatalog } from "../../src/harness-catalog.ts";
import type { HarnessInfo } from "../../src/harness-list.ts";
import type { ServerMessage } from "../../src/use-socket.ts";
import type { HarnessCatalogMessage } from "../../shared/harness-catalog.ts";

const info = (name: string, model: string): HarnessInfo => ({
  name, capabilities: {} as HarnessInfo["capabilities"], builtInTools: [],
  models: [{ id: model, label: model }], commands: [], agents: [], account: { provider: name },
});

describe("progressive harness_list wire contract", () => {
  it("uses the existing typed global envelope with a full baseline and singleton patches", () => {
    const baseline = { type: "harness_list", catalogMode: "snapshot", harnesses: [info("claude", "old"), info("pi", "old")] } satisfies HarnessCatalogMessage<HarnessInfo>;
    const patch = { type: "harness_list", catalogMode: "patch", harnesses: [info("claude", "new")] } satisfies HarnessCatalogMessage<HarnessInfo>;
    const typed: ServerMessage = baseline;
    expect(typed.type).toBe("harness_list");
    const inventory = mergeHarnessCatalog([], baseline.harnesses, baseline.catalogMode === "snapshot");
    expect(mergeHarnessCatalog(inventory, patch.harnesses, patch.catalogMode !== "patch").map(h => [h.name, h.models[0]?.id]))
      .toEqual([["claude", "new"], ["pi", "old"]]);
  });
});
