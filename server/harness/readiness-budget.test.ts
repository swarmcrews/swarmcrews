import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearHarnessReadinessCache, getHarnessReadiness } from "./readiness.ts";
import { checkPiReadiness } from "./pi/runtime.ts";
import { getPiModels } from "./pi/models.ts";
import type { HarnessReadinessContext, HarnessReadinessProbe } from "./readiness-types.ts";

const mocks = vi.hoisted(() => ({ harnesses: [] as Array<{
  name: string; checkReadiness: (context: HarnessReadinessContext) => Promise<HarnessReadinessProbe>;
}> }));
vi.mock("./index.ts", () => ({ productionHarnesses: () => mocks.harnesses,
  getHarness: () => { throw new Error("No test harness"); } }));

describe("readiness budgets and cache", () => {
  beforeEach(() => { vi.useFakeTimers(); clearHarnessReadinessCache(); mocks.harnesses = []; });
  afterEach(() => { clearHarnessReadinessCache(); vi.useRealTimers(); });

  it("accepts slow Pi wrapper startup and reuses the result until expiry or explicit refresh", async () => {
    const run = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 6_000));
      return { code: 0, stdout: "provider  model  thinking\nlocal  reasoner  yes\n" };
    });
    const discover = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 8_000));
      return []; // Optional metadata timed out; the catalog is still valid.
    });
    mocks.harnesses = [{ name: "pi", checkReadiness: context => checkPiReadiness(context, {
      resolve: () => ({ executable: "/fixture/pi-wrapper", source: "path" }), run, discover,
    }) }];
    const first = getHarnessReadiness();
    const concurrent = getHarnessReadiness();
    await vi.advanceTimersByTimeAsync(14_000);
    const snapshot = await first;
    expect(snapshot.readyHarnesses).toEqual(["pi"]);
    expect(await concurrent).toBe(snapshot);
    expect(getPiModels()).toMatchObject([{ id: "local/reasoner" }]);
    expect(run).toHaveBeenCalledWith("/fixture/pi-wrapper", ["--list-models"], expect.anything());
    expect(discover).toHaveBeenCalledWith("/fixture/pi-wrapper", expect.anything());
    expect(await getHarnessReadiness()).toBe(snapshot);
    expect(run).toHaveBeenCalledTimes(1);

    const refresh = getHarnessReadiness({ fresh: true });
    const duringRefresh = getHarnessReadiness();
    await vi.advanceTimersByTimeAsync(14_000);
    const refreshed = await refresh;
    expect(await duringRefresh).toBe(refreshed);
    expect(refreshed).not.toBe(snapshot);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_001);
    const expired = getHarnessReadiness();
    await vi.advanceTimersByTimeAsync(14_000);
    await expired;
    expect(run).toHaveBeenCalledTimes(3);
  });

  it.each([{ name: "pi", budget: 30_000 }, { name: "claude", budget: 5_000 }])(
    "bounds a stuck $name probe at $budget ms", async ({ name, budget }) => {
      let signal: AbortSignal | undefined;
      mocks.harnesses = [{ name, checkReadiness: context => {
        signal = context.signal;
        return new Promise(() => {});
      } }];
      const probe = getHarnessReadiness();
      await vi.advanceTimersByTimeAsync(budget - 1);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const snapshot = await probe;
      expect(signal?.aborted).toBe(true);
      expect(snapshot.ready).toBe(false);
      expect(snapshot.harnesses[0]?.state).toBe("probe_timeout");
    },
  );
});
