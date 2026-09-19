/** Deterministic MCP HTTP fixture for tests, using real SDK client negotiation. */
export function createMcpFixtureFetch(): typeof fetch {
  let session = 0;
  return async (input, init) => {
    if (init?.method === "GET" || init?.method === "DELETE") return new Response(null, { status: 405 });
    const request = JSON.parse(String(init?.body ?? "{}")) as { id?: number; method: string; params?: Record<string, unknown> };
    if (request.id === undefined) return new Response(null, { status: 202 });
    const params = request.params ?? {};
    let result: unknown = {};
    const headers = new Headers({ "Content-Type": "application/json" });
    if (request.method === "initialize") { result = { protocolVersion: "2025-06-18", serverInfo: { name: "fixture", version: "1.0" }, capabilities: { tools: {}, resources: {}, prompts: {} } }; headers.set("Mcp-Session-Id", `fixture-${++session}`); }
    if (request.method === "tools/list") result = { tools: [{ name: "echo", description: "Echo a message for verification", inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] } }] };
    if (request.method === "tools/call") result = params["name"] === "echo" ? { content: [{ type: "text", text: (params["arguments"] as Record<string, unknown>)["message"] }], structuredContent: { session: new Headers(init?.headers).get("Mcp-Session-Id") } } : { content: [{ type: "text", text: "Unknown tool" }], isError: true };
    if (request.method === "resources/list") result = { resources: [{ uri: "fixture://readme", name: "Readme" }] };
    if (request.method === "resources/read") result = { contents: [{ uri: params["uri"], mimeType: "text/plain", text: "Fixture resource" }] };
    if (request.method === "prompts/list") result = { prompts: [{ name: "greeting", arguments: [{ name: "name", required: true }] }] };
    if (request.method === "prompts/get") result = { messages: [{ role: "user", content: { type: "text", text: `Hello ${(params["arguments"] as Record<string, unknown>)["name"]}` } }] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { headers });
  };
}
