import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHarness } from "../index.ts";
import type { HarnessReasoningEffort, NormalizedEvent } from "../types.ts";
import { setPiModels } from "./models.ts";
import "./index.ts";

let directory: string;
let captured: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-reasoning-"));
  captured = path.join(directory, "args.json");
  const script = path.join(directory, "cli.mjs");
  const executable = path.join(directory, "pi");
  fs.writeFileSync(script, `import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(captured)}, JSON.stringify(process.argv.slice(2)));
fs.writeSync(1, JSON.stringify({ type: 'agent_end', messages: [] }) + '\\n');`);
  fs.writeFileSync(executable, `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${script}' "$@"\n`, { mode: 0o755 });
  vi.stubEnv("PI_PATH", executable);
  setPiModels([{ id: "native/model", label: "Model", source: "dynamic", supportsReasoning: true,
    supportedEffortLevels: ["minimal", "low", "medium", "high", "xhigh", "max"] }]);
});
afterEach(() => { vi.unstubAllEnvs(); setPiModels([]); fs.rmSync(directory, { recursive: true, force: true }); });

async function launch(effort?: HarnessReasoningEffort, resumeId?: string) {
  const events: NormalizedEvent[] = [];
  const run = getHarness("pi").start({ sessionKey: "pi-reasoning-test", cwd: directory,
    model: "native/model", prompt: "Fixture prompt", systemPrompt: "Fixture instructions", allowedTools: [],
    abortSignal: new AbortController().signal,
    ...(effort ? { thinking: { effort, display: "summarized" as const } } : {}),
    ...(resumeId ? { resumeId } : {}),
  });
  for await (const event of run.events) events.push(event);
  return events;
}

describe("Pi reasoning launch", () => {
  it.each<HarnessReasoningEffort>(["minimal", "low", "medium", "high", "xhigh", "max"])("forwards %s unchanged", async effort => {
    expect(await launch(effort)).toContainEqual(expect.objectContaining({ kind: "done", reason: "completed" }));
    const args = JSON.parse(fs.readFileSync(captured, "utf8")) as string[];
    expect(args[args.indexOf("--thinking") + 1]).toBe(effort);
  });

  it.each([undefined, "existing-session"])("explicitly turns thinking off, including resumed sessions (%s)", async resumeId => {
    await launch(undefined, resumeId);
    const args = JSON.parse(fs.readFileSync(captured, "utf8")) as string[];
    expect(args).toContain("--thinking");
    expect(args[args.indexOf("--thinking") + 1]).toBe("off");
  });
});
