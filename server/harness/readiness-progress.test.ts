import { describe, expect, it, vi } from "vitest";
import { ReadinessProgress } from "./readiness-progress.ts";
import type { HarnessReadiness } from "./readiness-types.ts";

const item = { name: "claude", ready: true, state: "ready", runtime: { available: true, source: "path" },
  auth: { authenticated: true, source: "cli_login" }, checkedAt: "", expiresAt: "", durationMs: 0 } satisfies HarnessReadiness;

describe("readiness progress generation", () => {
  it("rejects late completions and drops old listeners when a generation is cleared", () => {
    const progress = new ReadinessProgress();
    const old = progress.reset();
    const listener = vi.fn();
    progress.subscribe(listener);
    const next = progress.reset();
    progress.publish(old, item);
    progress.publish(next, item);
    expect(listener).not.toHaveBeenCalled();
    expect(progress.current()).toEqual([item]);
    const current = vi.fn();
    const stop = progress.subscribe(current);
    progress.publish(next, item);
    stop();
    progress.publish(next, item);
    expect(current).toHaveBeenCalledTimes(1);
  });
});
