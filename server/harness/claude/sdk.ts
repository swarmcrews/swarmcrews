import { resolveExternalSdk } from "../external-sdk.ts";

export function externalSdkUrl(): string | null {
  return resolveExternalSdk("@anthropic-ai/claude-agent-sdk", "CLAUDE_SDK_ROOT");
}

export async function loadSdk(): Promise<typeof import("@anthropic-ai/claude-agent-sdk")> {
  const external = externalSdkUrl();
  return external ? import(external) : import("@anthropic-ai/claude-agent-sdk");
}
