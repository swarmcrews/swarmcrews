import type { SessionEvent } from "@github/copilot-sdk";
import type { NormalizedEvent } from "../types.ts";

/** Translate incremental output independently from session lifecycle ownership. */
export function createCopilotTranslator(showThinking: boolean) {
  let blockIndex = 0;
  let result = "";
  let context: { contextTokens: number; contextWindowTokens: number } | undefined;
  return {
    result: () => result,
    context: () => context,
    translate(event: SessionEvent): NormalizedEvent[] {
      switch (event.type) {
        case "assistant.message_delta":
          return [{ kind: "text_delta", text: event.data.deltaContent, blockIndex,
            ...(event.data.parentToolCallId ? { parentId: event.data.parentToolCallId } : {}) }];
        case "assistant.message":
          if (event.data.parentToolCallId) return [];
          result = event.data.content;
          blockIndex++;
          return [{ kind: "stream_end" }, { kind: "text", role: "assistant", text: result, id: event.data.messageId }];
        case "assistant.reasoning":
          return showThinking ? [{ kind: "thinking", text: event.data.content }] : [];
        case "tool.execution_start":
          return [{ kind: "tool_call", id: event.data.toolCallId, name: event.data.toolName,
            input: event.data.arguments ?? {},
            ...(event.data.parentToolCallId ? { parentId: event.data.parentToolCallId } : {}) }];
        case "tool.execution_complete":
          return [{ kind: "tool_result", callId: event.data.toolCallId,
            output: event.data.result ?? event.data.error ?? "", isError: !event.data.success }];
        case "session.usage_info":
          context = { contextTokens: event.data.currentTokens, contextWindowTokens: event.data.tokenLimit };
          return [];
        case "assistant.usage":
          // Copilot's `cost` is a model multiplier, not dollars.
          return [{ kind: "usage", source: "assistant", input: event.data.inputTokens ?? 0,
            output: event.data.outputTokens ?? 0,
            ...(event.data.cacheReadTokens !== undefined ? { cacheRead: event.data.cacheReadTokens } : {}),
            ...(event.data.cacheWriteTokens !== undefined ? { cacheCreation: event.data.cacheWriteTokens } : {}),
            ...(event.data.parentToolCallId ? {} : context),
          }];
        default: return [];
      }
    },
  };
}
