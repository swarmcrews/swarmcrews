/** Optional metadata reported by a harness. Missing fields mean unknown. */
export interface HarnessModelInfo {
  id: string;
  label: string;
  description?: string;
  source?: "dynamic" | "static";
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  supportedEffortLevels?: string[];
  defaultEffortLevel?: string;
  contextWindowTokens?: number;
  maxPromptTokens?: number;
  maxOutputTokens?: number;
  vision?: { mediaTypes: string[]; maxImages: number; maxImageBytes: number };
  policy?: { state: string; terms?: string };
  /** Provider-native billing units; never implicitly interpreted as USD. */
  billing?: { multiplier?: number; unit?: string; tokenPrices?: Record<string, unknown> };
}
