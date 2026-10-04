import type { NormalizedEvent } from "../shared/normalized-event.ts";

/** Optional on hydrated canvas data; reducers initialize both fields. */
export interface ThinkingStreamState {
  streamingThinkingText?: string | undefined;
  streamingThinkingBlockIndex?: number | null | undefined;
}

export const EMPTY_THINKING_STREAM = { streamingThinkingText: "", streamingThinkingBlockIndex: null };

export function clearThinkingStream<T extends ThinkingStreamState>(state: T): T {
  return !state.streamingThinkingText && state.streamingThinkingBlockIndex == null
    ? state : { ...state, ...EMPTY_THINKING_STREAM };
}

export function appendThinkingDelta<T extends ThinkingStreamState>(state: T,
  event: Extract<NormalizedEvent, { kind: "thinking_delta" }>): T {
  if (event.parentId != null) return state;
  return { ...state, streamingThinkingText: ((state.streamingThinkingBlockIndex === event.blockIndex
    ? state.streamingThinkingText ?? "" : "") + event.text).slice(-65536),
    streamingThinkingBlockIndex: event.blockIndex };
}

/** Rebase a batched preview over unrelated durable canvas updates. */
export function thinkingStreamPatch(state: ThinkingStreamState): ThinkingStreamState {
  return { streamingThinkingText: state.streamingThinkingText ?? "",
    streamingThinkingBlockIndex: state.streamingThinkingBlockIndex ?? null };
}
