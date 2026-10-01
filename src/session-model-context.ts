import type { DisplayMessage } from "./sdk-messages.ts";
import type { TranscriptBoundary, TranscriptEntry } from "./components/SessionTranscript.tsx";

/** Move init metadata into navigation/context without changing the stored transcript. */
export function withSessionModelContext(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  const result: TranscriptEntry[] = [];
  let boundary: TranscriptBoundary | undefined;
  let messages: DisplayMessage[] = [];
  const flush = () => {
    const models = [...new Set(messages.map((message) => message.sessionModel).filter(Boolean))];
    if (boundary) {
      result.push(models.length && !boundary.disclosure
        ? { ...boundary, content: `${boundary.content} · ${models.join(" · ")}` }
        : boundary);
    }
    if (boundary && !boundary.disclosure && models.length) {
      result.push(...messages.filter((message) => !message.sessionModel));
    } else {
      // Before run history is available, put model metadata beside the user
      // turn instead. Init can arrive before or after the initial prompt.
      const context = new Map<number, string[]>();
      const hidden = new Set<number>();
      messages.forEach((message, index) => {
        if (!message.sessionModel) return;
        let userIndex = messages.findLastIndex((candidate, i) => i < index && candidate.role === "user");
        if (userIndex < 0) userIndex = messages.findIndex((candidate) => candidate.role === "user");
        if (userIndex < 0) return; // Keep the model visible until there is a host.
        context.set(userIndex, [...new Set([...(context.get(userIndex) ?? []), message.sessionModel])]);
        hidden.add(index);
      });
      messages.forEach((message, index) => {
        if (hidden.has(index)) return;
        const model = context.get(index)?.join(" · ");
        result.push(model ? { ...message, suffix: [message.suffix, `Model: ${model}`].filter(Boolean).join(" · ") } : message);
      });
    }
    messages = [];
  };
  for (const entry of entries) {
    if ("kind" in entry) {
      flush();
      boundary = entry;
    } else messages.push(entry);
  }
  flush();
  return result;
}
