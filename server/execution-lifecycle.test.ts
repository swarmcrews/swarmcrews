import { describe, it, expect } from "vitest";
import { ExecutionLifecycle } from "./execution-lifecycle.ts";

describe("server execution shutdown", () => {
  it("fences admission before cancellation and waits for the actual drain", async () => {
    const lifecycle = new ExecutionLifecycle<string>();
    const release = lifecycle.track("provider");
    let stopped = false;
    let finished = false;
    const shutdown = lifecycle.shutdown(async owner => {
      expect(owner).toBe("provider");
      expect(() => lifecycle.track("late")).toThrow(/shutting down/);
      stopped = true;
    }).then(() => { finished = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(stopped).toBe(true);
    expect(finished).toBe(false);
    release(); await shutdown;
    expect(finished).toBe(true);
  });
  it("tracks overlapping generations independently and does not equate cancellation failure with success", async () => {
    const lifecycle = new ExecutionLifecycle<string>();
    const release1 = lifecycle.track("provider");
    const release2 = lifecycle.track("provider");
    release1();
    await expect(lifecycle.shutdown(async () => { throw new Error("close failed"); })).rejects.toThrow("close failed");
    release2();
  });
});
