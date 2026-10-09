import { z } from "zod/v4";
import { isDeepStrictEqual } from "node:util";
import type { NormalizedToolDef, NormalizedToolResult } from "./types.ts";
import { errorResult } from "./tool-result.ts";
import { snapshotJsonObject } from "./tool-json.ts";

/** Shared portable descriptor, not authorization. MCP clients use draft-7. */
export function toolDescriptor(def: NormalizedToolDef) {
  if (def.outputSchema && !(def.outputSchema instanceof z.ZodObject)) {
    throw new Error(`Tool "${def.name}": outputSchema must be a ZodObject; nest records/unions inside an object envelope.`);
  }
  return {
    name: def.name,
    description: def.description,
    inputSchema: z.toJSONSchema(def.inputSchema, { io: "input", target: "draft-7" }),
    ...(def.outputSchema ? { outputSchema: z.toJSONSchema(def.outputSchema, { target: "draft-7" }) } : {}),
    annotations: {
      readOnlyHint: def.annotations?.readOnlyHint ?? false,
      destructiveHint: def.annotations?.destructiveHint ?? false,
      openWorldHint: def.annotations?.openWorldHint ?? false,
      ...(def.annotations?.idempotentHint !== undefined ? { idempotentHint: def.annotations.idempotentHint } : {}),
    },
  };
}

/** Raw-input boundary. Does not grant authority, retry, or promise rollback. */
export async function invokeTool(def: NormalizedToolDef, input: unknown): Promise<NormalizedToolResult> {
  try {
    const parsed = await def.inputSchema.safeParseAsync(input ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map(issue => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
      return errorResult(`Tool "${def.name}" received invalid arguments: ${issues}`);
    }
    return invokeValidatedTool(def, parsed.data);
  } catch (error) {
    return errorResult(`Tool "${def.name}" input validation failed before execution: ${String(error)}`);
  }
}

const outcomeWarning = "Side effects may already have occurred; inspect state before retrying.";

/**
 * Internal adapter boundary for SDK-validated input (Claude parses asynchronously
 * before its callback). Never use for raw transport arguments. Handlers consume
 * parsed input; do not repeat non-idempotent input normalization in handlers.
 */
export async function invokeValidatedTool(def: NormalizedToolDef, input: unknown): Promise<NormalizedToolResult> {
  const invalid = () => errorResult(`Tool "${def.name}" returned invalid output. ${outcomeWarning}`);
  let returned = false;
  try {
    const result = await def.handler(input);
    returned = true;
    if (!result || !Array.isArray(result.content)
      || Array.from(result.content).some(block => block?.type !== "text" || typeof block.text !== "string")
      || (result.isError !== undefined && typeof result.isError !== "boolean")) return invalid();
    // Snapshot before any async validator yields back to handler-owned state.
    const content = result.content.map(block => ({ type: "text" as const, text: block.text }));
    const isError = result.isError;
    const data = result.structuredContent === undefined ? undefined : snapshotJsonObject(result.structuredContent);
    if (def.outputSchema) {
      if (data === undefined) {
        if (!isError) return invalid();
      } else {
        const output = await def.outputSchema.safeParseAsync(snapshotJsonObject(data));
        // Compare JSON-visible data, not prototypes; never strip/default/coerce output.
        if (!output.success || !isDeepStrictEqual(snapshotJsonObject(output.data), data)) return invalid();
      }
    }
    return { content, ...(data === undefined ? {} : { structuredContent: data }),
      ...(isError === undefined ? {} : { isError }) };
  } catch (error) {
    return returned ? invalid()
      : errorResult(`Tool "${def.name}" threw: ${error instanceof Error ? error.message : String(error)}. ${outcomeWarning}`);
  }
}
