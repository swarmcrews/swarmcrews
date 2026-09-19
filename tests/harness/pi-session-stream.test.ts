import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPiTranslator } from "../../server/harness/pi/translate.ts";
import { createBus } from "../../server/bus.ts";
import { SessionHost } from "../../server/session-host.ts";
import { processNormalizedEvent } from "../../server/session-host-run.ts";
import { disablePersistence } from "../../server/session-persist.ts";
import type { AgentType, AgentTypeContext } from "../../server/agents/types.ts";
import { emptySessionStreamState, sessionStreamReducer } from "../../src/session-stream.ts";
import type { ServerMessage } from "../../src/use-socket.ts";

beforeEach(() => disablePersistence());
afterEach(() => vi.restoreAllMocks());

it("retains a streamed Pi reply in the live transcript and reconnect history", () => {
  const bus = createBus({ clients: new Set() } as never);
  const host = new SessionHost("pi-stream", "/tmp");
  host.status = "running";
  const agent: AgentType = {
    id: "default", wantsWorktree: false, buildSystemPrompt: () => undefined,
    getToolGroups: () => ({ toolGroups: {}, mcpToolNames: [] }),
  };
  const ctx = { sessionKey: host.id, cwd: host.cwd, bus, worktreeInfo: null,
    worktreeIsolation: false } as AgentTypeContext;
  let live = emptySessionStreamState(host.id);
  vi.spyOn(bus, "emitToSession").mockImplementation((_key, message) => {
    live = sessionStreamReducer(live, message as ServerMessage, "pi");
  });

  const reply = "Sup! What are we working on?";
  const translator = createPiTranslator("local/model", host.id);
  const providerEvents = [
    { type: "turn_start" },
    { type: "message_update", assistantMessageEvent: {
      type: "thinking_delta", contentIndex: 0, delta: "Considering a greeting",
    } },
    { type: "message_update", assistantMessageEvent: {
      type: "text_delta", contentIndex: 1, delta: "Sup! ",
    } },
    { type: "message_update", assistantMessageEvent: {
      type: "text_delta", contentIndex: 1, delta: "What are we working on?",
    } },
    { type: "message_end", message: {
      role: "assistant", content: [{ type: "text", text: reply }], stopReason: "stop",
    } },
    { type: "agent_end", messages: [] },
  ];
  for (const event of providerEvents) {
    for (const normalized of translator.translate(event)) {
      processNormalizedEvent(host, bus, agent, ctx, normalized);
    }
  }

  expect(translator.result()).toBe(reply);
  expect(live.streamingText).toBe("");
  expect(live.messages.filter(message => message.role === "assistant")
    .map(message => message.content)).toEqual([reply]);
  const replay = sessionStreamReducer(emptySessionStreamState(host.id), {
    type: "sync_response", sessionKey: host.id, found: true,
    status: host.status, events: host.eventBuffer,
  }, "pi");
  expect(replay.streamingText).toBe("");
  expect(replay.messages.filter(message => message.role === "assistant")
    .map(message => message.content)).toEqual([reply]);
});
