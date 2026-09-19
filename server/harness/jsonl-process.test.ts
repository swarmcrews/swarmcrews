import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { streamJsonlProcess } from "./jsonl-process.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
const launch = vi.mocked(spawn);
const input = () => ({ executable: "/fixture/pi", args: [], cwd: "/tmp", signal: new AbortController().signal });

function childProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
    kill: vi.fn((_signal?: string) => { close(-1); return true; }),
  });
  function close(code = 0) {
    child.stdout.end(); child.stderr.end(); child.emit("close", code);
  }
  launch.mockReturnValue(child as never);
  return { child, close };
}

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("JSONL process lifecycle", () => {
  it("never spawns a pre-aborted process", async () => {
    const { child } = childProcess();
    const stream = streamJsonlProcess({ ...input(), signal: AbortSignal.abort() });
    const next = stream.next();
    // The old implementation requires EOF and incorrectly spawns despite abort.
    child.stdout.end(); child.emit("close", 0);
    expect((await next).done).toBe(true);
    expect(launch).not.toHaveBeenCalled();
  });

  it("sends literal stdin and retains split JSON and Unicode line separators", async () => {
    const { child, close } = childProcess();
    let stdin = "";
    child.stdin.on("data", chunk => { stdin += String(chunk); });
    const stream = streamJsonlProcess({ ...input(), stdin: "@literal\n--help" });
    const first = stream.next();
    child.stdout.write('{"text":"a\u2028b');
    child.stdout.write('"}\r\n{"done":true}');
    close();
    expect((await first).value).toEqual({ raw: '{"text":"a\u2028b"}', value: { text: "a\u2028b" } });
    expect((await stream.next()).value).toEqual({ raw: '{"done":true}', value: { done: true } });
    expect((await stream.next()).value).toEqual({ code: 0, stderr: "" });
    expect(stdin).toBe("@literal\n--help");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("terminates and waits for a process when the stream consumer leaves", async () => {
    const { child } = childProcess();
    const stream = streamJsonlProcess(input());
    const first = stream.next();
    child.stdout.write('{"type":"session"}\n');
    await first;
    await stream.return({ code: -1, stderr: "" });
    expect(child.kill).toHaveBeenCalled();
  });

  it("escalates cancellation when a process ignores SIGTERM", async () => {
    vi.useFakeTimers();
    const { child, close } = childProcess();
    child.kill.mockImplementation(signal => { if (signal === "SIGKILL") close(-1); return true; });
    const controller = new AbortController();
    const stream = streamJsonlProcess({ ...input(), signal: controller.signal });
    const next = stream.next();
    controller.abort();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect((await next).done).toBe(true);
  });

  it.skipIf(process.platform === "win32")("signals the owned process group on POSIX", async () => {
    const { child, close } = childProcess();
    Object.assign(child, { pid: 123456 });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => { close(-1); return true; });
    const controller = new AbortController();
    const stream = streamJsonlProcess({ ...input(), signal: controller.signal });
    const next = stream.next();
    controller.abort();
    await next;
    expect(launch.mock.calls[0]![2]).toMatchObject({ detached: true });
    expect(kill).toHaveBeenCalledWith(-123456, "SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("handles stdin closure and reports spawn errors without an unhandled event", async () => {
    const { child, close } = childProcess();
    const stream = streamJsonlProcess({ ...input(), stdin: "prompt" });
    const next = stream.next();
    expect(() => child.stdin.emit("error", Object.assign(new Error("broken pipe"), { code: "EPIPE" }))).not.toThrow();
    child.emit("error", new Error("spawn denied"));
    close(-1);
    expect((await next).value).toEqual({ code: -1, stderr: "spawn denied" });
  });
});
