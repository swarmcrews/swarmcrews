import type { SandboxPolicy } from "../shared/workspace-contracts.ts";
import { sanitizeAttachments } from "./commands/attachment-sanitize.ts";

/** Keep queued and waiting turns equivalent at the provider boundary. */
export function continuationContext(input: {
  sandboxPolicy?: SandboxPolicy;
  displayPrompt?: string;
  attachments?: unknown[];
  connectionIds?: string[] | undefined; skillIds?: string[];
  skillValues?: Record<string, Record<string, string>>;
}) {
  return {
    ...(input.sandboxPolicy !== undefined ? { sandboxPolicy: input.sandboxPolicy } : {}),
    ...(input.displayPrompt !== undefined ? { displayPrompt: input.displayPrompt } : {}),
    ...(input.attachments !== undefined ? { attachments: sanitizeAttachments(input.attachments) ?? [] } : {}),
    ...(input.connectionIds !== undefined ? { connectionIds: input.connectionIds } : {}),
    ...(input.skillIds !== undefined ? { skillIds: input.skillIds } : {}),
    ...(input.skillValues !== undefined ? { skillValues: input.skillValues } : {}),
  };
}
