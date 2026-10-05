import { describe, expect, it } from "vitest";
import { createShutdown } from "./shutdown.ts";

describe("bounded server shutdown", () => {
  it("stops admission, awaits drain, cleans owned processes, then acknowledges restart exactly once", async () => {
    const order: string[] = [];
    let release!: () => void;
    const drain = new Promise<void>(resolve => { release = resolve; });
    const shutdown = createShutdown({
      stopAdmission: () => { order.push("stop"); }, drain: () => drain,
      cleanupOwned: () => { order.push("cleanup"); }, finish: code => { order.push(String(code)); }, report: () => {},
    });
    const first = shutdown(42); expect(shutdown()).toBe(first);
    expect(order).toEqual(["stop"]);
    release(); await first;
    expect(order).toEqual(["stop", "cleanup", "42"]);
  });
  it("fails closed but still cleans owned processes when a provider never drains", async () => {
    const order: string[] = [];
    await createShutdown({
      stopAdmission: () => {}, drain: () => new Promise(() => {}),
      cleanupOwned: () => { order.push("cleanup"); }, finish: code => { order.push(String(code)); },
      report: error => { expect(String(error)).toContain("timed out"); },
    }, 1)(42);
    expect(order).toEqual(["cleanup", "1"]);
  });
  it("does not acknowledge success after a cleanup error", async () => {
    let code;
    await createShutdown({ stopAdmission: () => {}, drain: async () => {}, cleanupOwned: () => { throw Error("failed"); }, finish: value => { code = value; }, report: () => {} })();
    expect(code).toBe(1);
  });
});
