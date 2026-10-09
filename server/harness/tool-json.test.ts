import { describe, expect, it } from "vitest";
import { snapshotJsonObject } from "./tool-json.ts";

describe("structured JSON snapshot", () => {
  it("retains nulls, dense arrays, repeated values and data keys without prototype mutation", () => {
    const child = Object.assign(Object.create(null) as object, { cursor: null });
    const data = Object.fromEntries([["__proto__", child], ["array", [child, child]]]);
    const snapshot = snapshotJsonObject(data);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype);
    expect(Object.hasOwn(snapshot, "__proto__")).toBe(true);
    expect(snapshot).not.toBe(data);
    expect((snapshot["array"] as unknown[])[0]).not.toBe(child);
  });
  it.each([null, [], undefined, new Date(), { value: -0 }, { value: Infinity }, { value: undefined }])(
    "rejects unsupported roots or JSON values", value => { expect(() => snapshotJsonObject(value)).toThrow(); });
  it("rejects deep values with a bounded error instead of unbounded recursion", () => {
    let data: Record<string, unknown> = { value: null };
    for (let i = 0; i < 110; i++) data = { child: data };
    expect(() => snapshotJsonObject(data)).toThrow("Unsupported JSON data");
  });
  it("does not invoke toJSON", () => {
    let called = false;
    expect(() => snapshotJsonObject({ toJSON() { called = true; return {}; } })).toThrow();
    expect(called).toBe(false);
  });
});
