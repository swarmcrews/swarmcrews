import { createServer } from 'node:net';
import { request } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export async function portAvailable(port) {
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
export function websocketReady(url, signal) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString('base64');
    const expected = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    const req = request(`${url}/ws`, { signal, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13', Origin: url } });
    const timer = setTimeout(() => req.destroy(new Error('WebSocket handshake timed out.')), 3000);
    req.once('error', error => { clearTimeout(timer); reject(error); });
    req.once('response', response => { clearTimeout(timer); response.resume(); reject(new Error(`WebSocket upgrade rejected (${response.statusCode}).`)); });
    req.once('upgrade', (response, socket) => {
      clearTimeout(timer); socket.destroy();
      if (response.statusCode === 101 && response.headers['sec-websocket-accept'] === expected) resolve();
      else reject(new Error('Invalid WebSocket handshake.'));
    });
    req.end();
  });
}
export async function checkApplication(url, signal) {
  signal?.throwIfAborted();
  const bounded = () => signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000);
  const front = await fetch(url, { signal: bounded(), redirect: 'error' });
  if (!front.ok || !(await front.text()).includes('id="root"')) throw new Error('Frontend is not ready.');
  const api = await fetch(`${url}/api/projects`, { signal: bounded(), redirect: 'error' });
  if (!api.ok || !Array.isArray(await api.json())) throw new Error('Backend API is not ready.');
  await websocketReady(url, signal);
}
export async function waitForApplication(url, timeout = 30_000, signal) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    signal?.throwIfAborted();
    try { await checkApplication(url, signal); return; } catch (error) { signal?.throwIfAborted(); last = error; }
    try { await delay(500, undefined, { signal }); }
    catch (error) { signal?.throwIfAborted(); throw error; }
  } while (Date.now() < deadline);
  throw new Error(`Application health check failed: ${last?.message}. Inspect the application log; setup will not kill an existing service.`);
}
