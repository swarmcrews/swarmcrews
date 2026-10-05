import { resolveExternalSdk } from "../external-sdk.ts";

export function externalSdkUrl(): string | null {
  return resolveExternalSdk("@github/copilot-sdk", "COPILOT_SDK_ROOT");
}

export async function loadSdk(): Promise<typeof import("@github/copilot-sdk")> {
  const external = externalSdkUrl();
  return external ? import(external) : import("@github/copilot-sdk");
}
