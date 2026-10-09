/**
 * Model-visible fallback for validated structured results. Shared with Pi's
 * standalone extension (no TS loader required). Preserve a distinct display;
 * omit only a single text block exactly duplicating the machine JSON or the
 * Connections {result} envelope's payload. Native display is never mutated.
 * This is data preservation, not preservation of redundant display formatting.
 */
export function toolResultText(result) {
  const data = result.structuredContent;
  if (data === undefined) return result.content.map(block => block.text).join("\n");
  const text = result.content.length === 1 ? result.content[0].text : undefined;
  const redundant = text !== undefined && (text === JSON.stringify(data)
    || (Object.keys(data).length === 1 && Object.hasOwn(data, "result") && text === JSON.stringify(data.result)));
  return JSON.stringify({ ...(redundant ? {} : { content: result.content }), structuredContent: data,
    ...(result.isError === undefined ? {} : { isError: result.isError }) });
}
