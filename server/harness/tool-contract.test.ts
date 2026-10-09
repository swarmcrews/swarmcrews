import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import type { NormalizedToolDef } from "./types.ts";
import { invokeTool, toolDescriptor } from "./tool-contract.ts";
import { structuredResult, toolResultText } from "./tool-result.ts";

const outputSchema = z.object({ value: z.string().nullable(), count: z.number() });
const definition = (handler: NormalizedToolDef["handler"]): NormalizedToolDef => ({
  name: "lookup", description: "Lookup", inputSchema: z.object({ count: z.number().default(1) }),
  outputSchema, handler,
});

describe("shared tool contract", () => {
  it("keeps machine data separate from its display summary, including explicit nulls", async () => {
    const data = { value: null, count: 1 };
    const handler = vi.fn(async () => structuredResult(data, { text: "One result" }));
    const result = await invokeTool(definition(handler), {});
    expect(handler).toHaveBeenCalledExactlyOnceWith({ count: 1 });
    expect(result).toEqual({ content: [{ type: "text", text: "One result" }], structuredContent: data });
    expect(data).toEqual({ value: null, count: 1 });
    expect(JSON.parse(toolResultText(result))).toEqual(result);
  });

  it("rejects invalid arguments before executing", async () => {
    const handler = vi.fn(async () => structuredResult({ value: null, count: 1 }));
    const result = await invokeTool(definition(handler), { count: "bad" });
    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Tool "lookup" received invalid arguments');
  });

  it.each([
    { content: [{ type: "text" as const, text: "missing" }] },
    { content: [], structuredContent: { value: "ok", count: "bad" } },
    { content: [], structuredContent: { value: null, count: Number.NaN } },
    { content: [], structuredContent: { value: null, count: 1, undeclared: true } },
  ])("fails closed on invalid successful output", async result => {
    const actual = await invokeTool(definition(async () => result), {});
    expect(actual.isError).toBe(true);
    expect(actual.structuredContent).toBeUndefined();
    expect(actual.content[0]?.text).toContain("invalid output");
  });

  it("does not require success data on a tool failure", async () => {
    const result = { content: [{ type: "text" as const, text: "Denied" }], isError: true };
    expect(await invokeTool(definition(async () => result), {})).toEqual(result);
  });

  it("preserves schema-valid structured error data", async () => {
    const result = structuredResult({ value: null, count: 0 }, { text: "Denied", isError: true });
    expect(await invokeTool(definition(async () => result), {})).toEqual(result);
  });

  it("converts exceptions to tool failures without replaying the handler", async () => {
    const handler = vi.fn(async () => { throw new Error("Cancelled"); });
    const result = await invokeTool(definition(handler), {});
    expect(handler).toHaveBeenCalledOnce();
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Tool "lookup" threw: Cancelled');
    expect(result.content[0]?.text).toContain("Side effects may already have occurred");
  });

  it("rejects structured failures that do not match the advertised schema", async () => {
    const result = await invokeTool(definition(async () => structuredResult({ error: "wrong shape" }, { isError: true })), {});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]?.text).toContain("invalid output");
  });

  it.each([undefined, Number.POSITIVE_INFINITY, new Date(), 1n, () => {}])("rejects lossy JSON values %s", async value => {
    const def = definition(async () => ({ content: [], structuredContent: { nested: value } }));
    delete def.outputSchema;
    expect((await invokeTool(def, {})).isError).toBe(true);
  });

  it("rejects cycles but accepts repeated references", async () => {
    const nested: Record<string, unknown> = { value: null };
    const def = definition(async () => ({ content: [], structuredContent: { a: nested, b: nested } }));
    delete def.outputSchema;
    expect((await invokeTool(def, {})).isError).toBeUndefined();
    nested["self"] = nested;
    expect((await invokeTool(def, {})).isError).toBe(true);
  });

  it("advertises defaulted arguments as optional inputs", () => {
    const descriptor = toolDescriptor(definition(async () => structuredResult({ value: null, count: 1 })));
    expect(descriptor.inputSchema["required"] ?? []).not.toContain("count");
    expect(descriptor.outputSchema?.["required"]).toContain("count");
  });

  it("advertises the same output schema and annotations independently of transport", () => {
    expect(toolDescriptor({ ...definition(async () => structuredResult({ value: null, count: 1 })),
      annotations: { readOnlyHint: true, idempotentHint: true } })).toMatchObject({
      name: "lookup", outputSchema: { type: "object", required: ["value", "count"] },
      annotations: { readOnlyHint: true, idempotentHint: true },
    });
  });
  it("awaits async input refinements before execution", async () => {
    const handler = vi.fn(async () => structuredResult({ value: null, count: 1 }));
    const def = { ...definition(handler), inputSchema: z.object({ count: z.number().refine(async n => n > 0) }) };
    expect((await invokeTool(def, { count: 1 })).isError).not.toBe(true);
    expect(handler).toHaveBeenCalledExactlyOnceWith({ count: 1 });
    expect((await invokeTool(def, { count: 0 })).isError).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("warns of possible effects after post-handler validation failure", async () => {
    let effects = 0;
    const result = await invokeTool(definition(async () => {
      effects++; return structuredResult({ value: null, count: "wrong" }, { text: "Completed" });
    }), {});
    expect(effects).toBe(1);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Side effects may already have occurred");
    expect(result.content[0]?.text).toContain("inspect state before retrying");
  });

  it.each([
    () => Object.defineProperty({}, "cursor", { value: null }),
    () => Object.assign([null], { cursor: null }),
    () => Object.assign([null], { [Symbol("hidden")]: null }),
    () => ({ value: -0 }),
    () => Array(1),
  ])("rejects properties/values that JSON would silently drop or change", async makeValue => {
    const def = { ...definition(async () => ({ content: [], structuredContent: { result: makeValue() } })),
      outputSchema: z.object({ result: z.json() }) };
    expect((await invokeTool(def, {})).isError).toBe(true);
  });

  it("rejects getters without executing them", async () => {
    const get = vi.fn(() => null);
    const nested = Object.defineProperty({}, "cursor", { enumerable: true, get });
    const def = definition(async () => ({ content: [], structuredContent: { nested } }));
    delete def.outputSchema;
    expect((await invokeTool(def, {})).isError).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it("compares JSON data rather than object prototypes and returns a detached snapshot", async () => {
    const data = Object.assign(Object.create(null) as Record<string, unknown>, { value: null, count: 1 });
    const result = await invokeTool(definition(async () => ({ content: [], structuredContent: data })), {});
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ value: null, count: 1 });
    data["count"] = 2;
    expect(result.structuredContent?.["count"]).toBe(1);
  });

  it("rejects unsupported output roots at descriptor construction", () => {
    const def = { ...definition(async () => ({ content: [] })), outputSchema: z.record(z.string(), z.string()) } as unknown as NormalizedToolDef;
    expect(() => toolDescriptor(def)).toThrow(/lookup.*outputSchema.*ZodObject/);
  });

  it("snapshots content and failure status before asynchronous output validation", async () => {
    let release!: () => void; let validating!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { validating = resolve; });
    const result = structuredResult({ value: null, count: 1 }, { text: "Original" });
    const def = { ...definition(async () => result), outputSchema: outputSchema.refine(async () => {
      validating(); await gate; return true;
    }) };
    const pending = invokeTool(def, {});
    await started;
    result.content[0]!.text = "Changed"; result.isError = true;
    release();
    expect(await pending).toEqual({ content: [{ type: "text", text: "Original" }], structuredContent: { value: null, count: 1 } });
  });

});
