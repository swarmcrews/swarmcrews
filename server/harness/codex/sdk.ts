import { resolveExternalSdk } from "../external-sdk.ts";

export function externalSdkUrl(): string | null {
  return resolveExternalSdk("@openai/codex-sdk", "CODEX_SDK_ROOT");
}

export async function loadSdk(): Promise<typeof import("@openai/codex-sdk")> {
  const external = externalSdkUrl();
  return external ? import(external) : import("@openai/codex-sdk");
}
