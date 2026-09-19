import { createInterface } from 'node:readline';
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  const { id, method, params = {} } = request;
  if (method === 'initialize') reply(id, { protocolVersion: '2025-06-18', serverInfo: { name: 'fixture', version: '1.0' }, capabilities: { tools: {}, resources: {}, prompts: {} } });
  else if (method === 'tools/list') reply(id, { tools: [{ name: 'echo', description: 'Echo a message for verification', inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } }] });
  else if (method === 'tools/call') {
    if (params.name === 'echo') reply(id, { content: [{ type: 'text', text: params.arguments.message }], structuredContent: { pid: process.pid, cwd: process.cwd(), argv: process.argv.slice(2) } });
    else reply(id, { content: [{ type: 'text', text: 'Unknown tool' }], isError: true });
  } else if (method === 'resources/list') reply(id, { resources: [{ uri: 'fixture://readme', name: 'Readme' }] });
  else if (method === 'resources/read') reply(id, { contents: [{ uri: params.uri, mimeType: 'text/plain', text: 'Fixture resource' }] });
  else if (method === 'prompts/list') reply(id, { prompts: [{ name: 'greeting', arguments: [{ name: 'name', required: true }] }] });
  else if (method === 'prompts/get') reply(id, { messages: [{ role: 'user', content: { type: 'text', text: `Hello ${params.arguments.name}` } }] });
  else reply(id, {});
}
