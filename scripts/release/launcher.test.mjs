import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { killOwnedProcess } from "../../shared/owned-processes.mjs";

function deadline(promise, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label)), 5_000); })]).finally(() => clearTimeout(timer));
}
for (const action of ["shutdown", "restart", "fatal"]) {
  test(`portable supervisor cleans detached providers on ${action}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "portable supervisor "));
    const sockets = []; const pids = [];
    const listener = createServer(socket => { sockets.push(socket); socket.on("error", () => {}); });
    listener.listen(0, "127.0.0.1"); await once(listener, "listening");
    let child;
    try {
      mkdirSync(join(root, "server")); mkdirSync(join(root, "shared"));
      copyFileSync(new URL("./launcher.mjs", import.meta.url), join(root, "swarmcrews.mjs"));
      copyFileSync(new URL("../../shared/owned-processes.mjs", import.meta.url), join(root, "shared/owned-processes.mjs"));
      writeFileSync(join(root, "package.json"), '{"type":"module"}');
      writeFileSync(join(root, "release.json"), JSON.stringify({ version: "0.1.0-alpha.1", target: `${process.platform}-${process.arch}`, nodeVersion: process.versions.node }));
      writeFileSync(join(root, "server/index.js"), `import {spawn} from 'node:child_process';
import {observeOwnedProcesses} from '../shared/owned-processes.mjs';
observeOwnedProcesses();
const child = spawn(process.execPath,['-e',\`const socket=require('node:net').connect(Number(process.env.FIXTURE_PORT),'127.0.0.1',()=>socket.write(String(process.pid)+'\\\\n')); socket.on('data',data=>process.send(String(data)));\`],{detached:process.platform!=='win32',stdio:['ignore','ignore','ignore','ipc']});
child.on('message',action=>{ if(action==='fatal') process.exit(7); if(action==='restart') process.send({type:'shutdown-ready',code:42}); });
process.on('message',message=>{if(message==='shutdown') process.send({type:'shutdown-ready',code:0});});
process.on('SIGTERM',()=>process.exit(0));
`);
      const connected = once(listener, "connection");
      child = spawn(process.execPath, [join(root, "swarmcrews.mjs")], { env: { ...process.env, FIXTURE_PORT: String(listener.address().port) }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
      child.stderr.on("data", () => {}); child.stdout.resume();
      const [socket] = await deadline(connected, "provider did not connect");
      const [pid] = await deadline(once(socket, "data"), "provider PID missing"); pids.push(parseInt(pid));
      const disconnected = once(socket, "close");
      const exit = once(child, "exit");
      if (action === "shutdown") child.send("shutdown");
      else socket.write(action);
      await deadline(disconnected, "owned provider survived server shutdown");
      if (action === "restart") {
        const replacement = sockets[1] ?? (await deadline(once(listener, "connection"), "replacement did not launch"))[0];
        const [nextPid] = await deadline(once(replacement, "data"), "replacement PID missing"); pids.push(parseInt(nextPid));
        const closed = once(replacement, "close"); child.send("shutdown"); await deadline(closed, "replacement survived shutdown");
      }
      const [code] = await deadline(exit, "supervisor did not exit");
      assert.equal(code, action === "fatal" ? 7 : 0);
    } finally {
      if (child?.exitCode === null) { child.kill("SIGKILL"); await once(child, "exit"); }
      for (const pid of pids) killOwnedProcess(pid, process.platform !== "win32");
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => listener.close(resolve));
      rmSync(root, { recursive: true, force: true });
    }
  });
}
