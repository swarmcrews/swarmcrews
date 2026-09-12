import { sanitizeAttachments } from "./commands/attachment-sanitize.ts";

/** Keep queued and waiting turns equivalent at the provider boundary. */
export function continuationContext(input: {
  displayPrompt?: string;
  attachments?: unknown[];
  skillIds?: string[];
  skillValues?: Record<string, Record<string, string>>;
}) {
  return {
    ...(input.displayPrompt !== undefined ? { displayPrompt: input.displayPrompt } : {}),
    ...(input.attachments !== undefined ? { attachments: sanitizeAttachments(input.attachments) ?? [] } : {}),
    ...(input.skillIds !== undefined ? { skillIds: input.skillIds } : {}),
    ...(input.skillValues !== undefined ? { skillValues: input.skillValues } : {}),
  };
}
