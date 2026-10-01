import { describe, expect, it } from "vitest";
import { mergeHarnessCatalog } from "./harness-catalog.ts";
import type { HarnessInfo } from "./harness-list.ts";

const info = (name: string): HarnessInfo => ({ name, capabilities: {} as HarnessInfo["capabilities"], builtInTools: [],
  models: [], commands: [], agents: [], account: { provider: name } });

describe("progressive harness catalog", () => {
  it("replaces removed harnesses on a new baseline but preserves other entries on singleton updates", () => {
    const first = [info("claude"), info("pi")];
    expect(mergeHarnessCatalog(first, [info("claude")], false)).toEqual(first);
    expect(mergeHarnessCatalog(first, [info("claude")], true)).toEqual([info("claude")]);
  });
});
