import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { checkApplication, portAvailable, websocketReady } from './health.mjs';

test('health verifies frontend, backend and a real WebSocket handshake, not just a live process', async () => {
  let failApi = false;
  const server = createServer((req, res) => {
    if (req.url === '/api/projects') { res.writeHead(failApi ? 503 : 200, { 'Content-Type': 'application/json' }); res.end('[]'); }
    else res.end('<div id="root"></div>');
  });
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.end(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    assert.equal(await portAvailable(port), false);
    await checkApplication(`http://127.0.0.1:${port}`);
    const cancelled = new AbortController(); cancelled.abort(new Error('Setup cancelled'));
    await assert.rejects(checkApplication(`http://127.0.0.1:${port}`, cancelled.signal), /cancelled/);
    failApi = true;
    await assert.rejects(checkApplication(`http://127.0.0.1:${port}`), /Backend/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  assert.equal(await portAvailable(port), true);
});

test('an HTTP 200 at /ws is not a WebSocket success', async () => {
  const server = createServer((_req, res) => res.end('not a websocket'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await assert.rejects(websocketReady(`http://127.0.0.1:${server.address().port}`), /rejected/); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
