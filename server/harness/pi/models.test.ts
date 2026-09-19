import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPiNativeMetadata, getPiModels, parsePiModels, resolvePiModel, setPiModels } from "./models.ts";
import { checkPiReadiness } from "./runtime.ts";

const context = () => ({ signal: new AbortController().signal });

describe("Pi model discovery", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps a discovered catalog ready when optional capability discovery fails", async () => {
    const result = await checkPiReadiness(context(), {
      resolve: () => ({ executable: "/fixture/pi-wrapper", source: "path" }),
      run: async () => ({ code: 0, stdout: "provider  model  thinking\nlocal  reasoner  yes\n" }),
      discover: async () => { throw new Error("RPC unsupported"); },
    });
    expect(result.state).toBe("ready");
    expect(getPiModels()).toMatchObject([{ id: "local/reasoner", supportsReasoning: true }]);
  });

  it("bounds wrapper catalog startup and skips metadata after timeout", async () => {
    vi.useFakeTimers();
    const discover = vi.fn();
    const probe = checkPiReadiness(context(), {
      resolve: () => ({ executable: "/fixture/pi-wrapper", source: "path" }),
      run: (_executable, _args, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
      discover,
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await probe).state).toBe("probe_timeout");
    expect(discover).not.toHaveBeenCalled();
    expect(getPiModels()).toEqual([]);
  });
  it("does not publish late results after readiness cancellation", async () => {
    const controller = new AbortController();
    const result = await checkPiReadiness({ signal: controller.signal }, {
      resolve: () => ({ executable: "/fixture/pi", source: "path" }),
      run: async () => ({ code: 0, stdout: "provider  model  thinking\nlocal  reasoner  yes\n" }),
      discover: async () => { controller.abort(); return [{ provider: "local", id: "reasoner", reasoning: true }]; },
    });
    expect(result.state).toBe("probe_timeout");
    expect(getPiModels()).toEqual([]);
  });

  it("clears stale capability metadata when a probe throws", async () => {
    setPiModels([{ id: "stale/model", label: "Stale" }]);
    expect(await checkPiReadiness(context(), {
      resolve: () => ({ executable: "/fixture/pi", source: "path" }),
      run: async () => { throw new Error("failed to launch"); },
    })).toMatchObject({ state: "probe_failed" });
    expect(getPiModels()).toEqual([]);
  });
  it("preserves image support from the native padded model catalog", () => {
    expect(parsePiModels("provider  model  context  max-out  thinking  images\n" +
      "anthropic  vision-model  200K  64K  yes  yes\n" +
      "ollama  text-model  128K  8K  no  no\n")).toEqual([
      { id: "anthropic/vision-model", label: "anthropic/vision-model", supportsVision: true, supportsReasoning: true },
      { id: "ollama/text-model", label: "ollama/text-model", supportsVision: false, supportsReasoning: false },
    ]);
  });

  it("uses Pi's per-model reasoning map instead of treating the CLI thinking column as low/medium/high", () => {
    const listed = parsePiModels("provider  model  context  max-out  thinking  images\n" +
      "native  max-model  200K  64K  yes  no\n" +
      "native  text-model  200K  64K  no  no\n");
    expect(applyPiNativeMetadata(listed, [
      { provider: "native", id: "max-model", reasoning: true,
        thinkingLevelMap: { xhigh: "xhigh", max: "max" } },
      { provider: "native", id: "text-model", reasoning: false },
    ])).toEqual([
      { source: "dynamic", id: "native/max-model", label: "native/max-model", supportsVision: false,
        supportsReasoning: true, supportedEffortLevels: ["minimal", "low", "medium", "high", "xhigh", "max"] },
      { source: "dynamic", id: "native/text-model", label: "native/text-model", supportsVision: false,
        supportsReasoning: false, supportedEffortLevels: [] },
    ]);
  });

  it("honors Pi null exclusions while allowing ordinary undefined map entries", () => {
    const listed = parsePiModels("Provider\tModel\tThinking\nlocal\tlimited\tyes\n");
    expect(applyPiNativeMetadata(listed, [{ provider: "local", id: "limited", reasoning: true,
      thinkingLevelMap: { minimal: null, high: null, xhigh: undefined, max: null } }]))
      .toMatchObject([{ supportsReasoning: true, supportedEffortLevels: ["low", "medium"] }]);
  });

  it("uses the images header position and leaves unrecognized capability values unknown", () => {
    expect(parsePiModels("Provider\tModel\tName\tImages\n" +
      "local\tvision\tVision Model\t\u001b[32myes\u001b[0m\n" +
      "local\tunknown\tUnknown Model\tunknown\n")).toEqual([
      { id: "local/vision", label: "Vision Model", supportsVision: true },
      { id: "local/unknown", label: "Unknown Model" },
    ]);
  });

  it("parses provider/model TSV rows", () => {
    const stdout = "Provider\tModel\tName\tContext\n" +
      "anthropic\tclaude-sonnet-4-5\tClaude Sonnet 4.5\t200000\n" +
      "ollama\tqwen2.5-coder:7b\tQwen Coder\t128000\n";
    expect(parsePiModels(stdout)).toEqual([
      { id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
      { id: "ollama/qwen2.5-coder:7b", label: "Qwen Coder" },
    ]);
  });

  it("accepts already-prefixed model rows and rejects the empty notice", () => {
    expect(parsePiModels("openai/gpt-5.2\tGPT-5.2\nNo models available. Set API keys.\n")).toEqual([
      { id: "openai/gpt-5.2", label: "openai/gpt-5.2" },
    ]);
  });

  it("reports the PATH runtime ready when configured models are available", async () => {
    const result = await checkPiReadiness(context(), {
      resolve: () => ({ executable: "/fixture/pi", source: "path" }),
      run: async () => ({ code: 0, stdout: "ollama\tqwen-coder\tQwen Coder\n" }),
      discover: async () => [],
    });
    expect(result).toMatchObject({ state: "ready", runtime: { source: "path" }, auth: { authenticated: true } });
  });

  it("keeps discovery provenance even when native metadata is unavailable", () => {
    expect(applyPiNativeMetadata([{ id: "custom/model", label: "Custom", supportsReasoning: true }], []))
      .toEqual([{ id: "custom/model", label: "Custom", supportsReasoning: true, source: "dynamic" }]);
  });

  it("enriches readiness models with the configured runtime's capabilities", async () => {
    await checkPiReadiness(context(), {
      resolve: () => ({ executable: "/fixture/pi", source: "path" }),
      run: async () => ({ code: 0, stdout: "provider  model  thinking\nlocal  limited  yes\n" }),
      discover: async () => [{ provider: "local", id: "limited", reasoning: true,
        thinkingLevelMap: { minimal: null, xhigh: "xhigh", max: "max" } }],
    });
    expect(getPiModels()).toMatchObject([{ id: "local/limited", source: "dynamic",
      supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] }]);
  });

  it("passes provider/model ids through unchanged", () => {
    expect(resolvePiModel("ollama/qwen-coder")).toBe("ollama/qwen-coder");
    expect(resolvePiModel("")).toBeNull();
  });
});
