import { expect, it } from "vitest";
import { normalizedToDisplayMessages, type DisplayMessage } from "./sdk-messages.ts";
import { withSessionModelContext } from "./session-model-context.ts";
import type { TranscriptEntry } from "./components/SessionTranscript.tsx";

const init = (model: string) => normalizedToDisplayMessages({ kind: "init", model, sessionId: "session" })[0]!;
const user = (id: string): DisplayMessage => ({ id, role: "user", content: id, timestamp: 1 });

it("keeps init visible when neither a user nor a boundary is available", () => {
  const messages = [init("model")];
  expect(withSessionModelContext(messages)).toEqual(messages);
});

it("only relocates typed init metadata, not arbitrary system text", () => {
  const messages = [user("prompt"), { id: "notice", role: "system" as const, content: "Session on model", timestamp: 1 }];
  expect(withSessionModelContext(messages)).toEqual(messages);
});

it("retains per-turn model changes and existing suffixes without mutating input", () => {
  const messages = [init("first"), { ...user("prompt"), suffix: "Attached context" },
    user("follow-up"), init("second"), init("second")];
  expect(withSessionModelContext(messages)).toEqual([
    { ...messages[1], suffix: "Attached context · Model: first" },
    { ...messages[2], suffix: "Model: second" },
  ]);
  expect(messages[1]?.suffix).toBe("Attached context");
  expect(messages).toHaveLength(5);
});

it("isolates iteration models, deduplicates init, and leaves disclosure navigation intact", () => {
  const entries: TranscriptEntry[] = [
    { kind: "run-boundary", id: "one", label: "Iteration 1", content: "Iteration 1" },
    init("first"), init("first"), init("second"),
    { kind: "run-boundary", id: "two", label: "Iteration 2", content: "Iteration 2" },
    user("next"),
    { kind: "run-boundary", id: "older", label: "Earlier", content: "Earlier", disclosure: () => null },
  ];
  expect(withSessionModelContext(entries)).toEqual([
    { ...entries[0], content: "Iteration 1 · first · second" }, entries[4], entries[5], entries[6],
  ]);
});
