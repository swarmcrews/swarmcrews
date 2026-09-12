import { describe, expect, it } from "vitest";
import { createFilePathExtractor } from "./ProjectPanel.tsx";
import { emptySessionStreamState, sessionStreamReducer } from "./session-stream.ts";
import type { NormalizedEvent } from "../shared/normalized-event.ts";

const call: NormalizedEvent = { kind: "tool_call", id: "edit-1", name: "codex_file_change", input: {} };
const result: NormalizedEvent = { kind: "tool_result", callId: "edit-1", output: { changes: [{ path: "README.md", kind: "update" }] }, isError: false };

describe("project file activity", () => {
  it("reads structured file and folder inputs, including spaces and paths outside src", () => {
    const extract = createFilePathExtractor();
    expect(extract([
      { role: "tool", content: "Read", toolName: "Read", toolInput: { file_path: "/repo/docs/my notes.md" } },
      { role: "tool", content: "Grep", toolName: "Grep", toolInput: { path: "docs" } },
      { role: "tool", content: "Write", toolName: "Write", toolInput: { file_path: "package.json" } },
      { role: "assistant", content: "We could change src/unrelated.ts" },
    ])).toEqual(["/repo/docs/my notes.md", "docs", "package.json"]);
  });

  it("keeps all touched paths and extracts patch destinations", () => {
    const paths = Array.from({ length: 12 }, (_, i) => `docs/${i}.md`);
    expect(createFilePathExtractor()([
      ...paths.map(path => ({ role: "tool", content: "Read", toolInput: { file_path: path } })),
      { role: "tool", content: "apply_patch", toolInput: { input: "*** Update File: old.md\n*** Move to: new.md\n+src/not-activity.ts" } },
    ])).toEqual([...paths, "old.md", "new.md"]);
  });

  it("adds completed Codex paths to the existing call in live updates and replay", () => {
    const initial = emptySessionStreamState("session");
    const events = [call, result].map(event => ({ type: "sdk_event" as const, sessionKey: "session", timestamp: 1, event }));
    const live = events.reduce((state, event) => sessionStreamReducer(state, event, "agent"), initial);
    const replay = sessionStreamReducer(initial, { type: "sync_response", sessionKey: "session", found: true, status: "running", events }, "agent");
    for (const state of [live, replay]) {
      expect(state.messages).toHaveLength(1);
      expect(createFilePathExtractor()(state.messages)).toEqual(["README.md"]);
    }
    expect(sessionStreamReducer(live, events[1]!, "agent")).toBe(live);
  });
});
