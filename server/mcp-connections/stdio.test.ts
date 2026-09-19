import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveMcpServer } from "../mcp-server-store.ts";
import { inspectConnection, invokeConnection, closeConnectionScope, invalidateConnection } from "./runtime.ts";
const spawnProbe = spawnSync(process.execPath, ["-e", "process.stdout.write('ok')"], { encoding: "utf8" });
it.skipIf(Boolean(spawnProbe.error) || spawnProbe.stdout !== "ok")("starts a real stdio process and preserves argv, cwd, tool results and shutdown", async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-stdio-"));
  try {
    saveMcpServer(project, { id: "fixture", name: "Fixture", transport: "stdio", command: process.execPath, args: [path.resolve("tests/fixtures/mcp/server.mjs"), "a b", ""] });
    expect((await inspectConnection(project, "fixture", "stdio-test")).tools[0]?.name).toBe("echo");
    const result = await invokeConnection(project, "fixture", "stdio-test", "tool", "echo", { message: "hello" }) as { structuredContent: { pid: number; argv: string[]; cwd: string } };
    expect(result.structuredContent).toMatchObject({ argv: ["a b", ""], cwd: project });
    await closeConnectionScope("stdio-test"); expect(() => process.kill(result.structuredContent.pid, 0)).toThrow();
  } finally { await closeConnectionScope("stdio-test"); await invalidateConnection(project, "fixture"); fs.rmSync(project, { recursive: true, force: true }); }
});
