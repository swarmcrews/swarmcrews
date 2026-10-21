import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { runPodmanCommand } from "./process.ts";
// OS process boundary only; runner modules remain real.
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function child() {
  const process = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  process.kill.mockImplementation(() => { process.emit("close", null); return true; });
  vi.mocked(spawn).mockReturnValue(process as never); return process;
}
it("uses a fixed local executable, no shell, and no inherited credentials or daemon routing", async () => {
  const process = child(); const output: string[] = [];
  const result = runPodmanCommand(["info", "--format=json"], text => output.push(text));
  expect(spawn).toHaveBeenLastCalledWith("/usr/bin/podman", ["--remote=false", "info", "--format=json"], expect.objectContaining({ shell: false, stdio: ["ignore", "pipe", "pipe"] }));
  const options = vi.mocked(spawn).mock.calls.at(-1)![2] as { env: Record<string, string> };
  expect(Object.keys(options.env).sort()).toEqual(expect.arrayContaining(["PATH", "LANG"]));
  expect(Object.keys(options.env).every(key => ["PATH", "LANG", "HOME", "XDG_RUNTIME_DIR", "USER", "LOGNAME"].includes(key))).toBe(true);
  process.stdout.write("stdout"); process.stderr.write("stderr"); process.emit("close", 0);
  expect(await result).toBe(0); expect(output).toEqual(["stdout", "stderr"]);
});
it("abort and bounded command timeout kill the CLI and settle", async () => {
  vi.useFakeTimers(); const process = child(); const controller = new AbortController();
  const result = runPodmanCommand(["start"], () => {}, controller.signal); controller.abort();
  expect(await result).toBeNull(); expect(process.kill).toHaveBeenCalledWith("SIGKILL");
  const next = child(); const timed = runPodmanCommand(["info"], () => {}, undefined, 50);
  await vi.advanceTimersByTimeAsync(50); expect(await timed).toBeNull(); expect(next.kill).toHaveBeenCalledTimes(1);
});
it("reports spawn errors and never tries another executable", async () => {
  const process = child(); const before = vi.mocked(spawn).mock.calls.length;
  const result = runPodmanCommand(["info"], () => {}); const rejected = expect(result).rejects.toThrow("missing");
  process.emit("error", new Error("missing")); await rejected;
  expect(vi.mocked(spawn).mock.calls.length - before).toBe(1);
});
it("settles the timeout even if inherited pipes never emit close", async () => {
  vi.useFakeTimers(); const process = child(); process.kill.mockImplementation(() => true);
  let settled = false; const result = runPodmanCommand(["create"], () => {}, undefined, 50).then(code => { settled = true; return code; });
  await vi.advanceTimersByTimeAsync(51);
  try { expect(settled).toBe(true); } finally { process.emit("close", null); await result; }
});
