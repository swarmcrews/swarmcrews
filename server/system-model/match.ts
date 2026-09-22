import type { SystemModelObjectType } from "../../shared/system-model/index.ts";
import type { LoadedSystemModel } from "./types.ts";
import { rankSystemModel } from "./search-index.ts";

export const LOW_CONFIDENCE_FALLBACK = "inspect repo; ask only if required";
export const SEARCH_RANKING_VERSION = "hybrid-path-v1";

export interface MatchCandidate {
  id: string;
  type: SystemModelObjectType;
  score: number;
  reasons: string[];
}

export interface MatchResult {
  candidates: MatchCandidate[];
  matchConfidence: "high" | "medium" | "low";
  fallbackInstruction?: string;
}

export function matchSystemModel(input: {
  model: LoadedSystemModel;
  request: string;
  files?: string[];
  keywords?: string[];
  objectTypes?: SystemModelObjectType[];
  topK?: number;
}): MatchResult {
  const ranked = rankSystemModel(input.model.objectsById.values(),
    [input.request, ...(input.keywords ?? [])].join(" "), input.files ?? [], globMatches);
  // The full corpus supplies IDF and graph evidence even when callers narrow types.
  const selected = ranked.rows.filter(row => !input.objectTypes?.length || input.objectTypes.includes(row.type))
    .slice(0, Math.max(0, input.topK ?? 5));
  const top = selected[0];
  let matchConfidence: MatchResult["matchConfidence"] = "low";
  // Confidence uses direct, unpromoted evidence. It is advisory, never authority
  // to omit applicable constraints or to infer a child's owned scope.
  if (top && top.direct >= 2 && top.direct / Math.max(1, ranked.queryTerms) >= 0.6) matchConfidence = "medium";
  if (top && top.direct >= 2 && top.direct / Math.max(1, ranked.queryTerms) >= 0.75 && top.baseScore >= 6) matchConfidence = "high";
  return {
    candidates: selected.map(({ id, type, score, reasons }) => ({ id, type, score, reasons })),
    matchConfidence,
    ...(matchConfidence === "low" ? { fallbackInstruction: LOW_CONFIDENCE_FALLBACK } : {}),
  };
}

export function globMatches(glob: string, file: string): boolean {
  return compileGlobMatcher(glob)(file);
}

/** Compile once when scanning a file inventory; no process-wide cache of user patterns. */
export function compileGlobMatcher(glob: string): (file: string) => boolean {
  const pattern = glob.replaceAll("\\", "/").replace(/^\.\//, "");
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") { source += "(?:.*/)?"; i++; }
      else source += ".*";
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const regex = new RegExp(`^${source}$`);
  return (file) => regex.test(file.replaceAll("\\", "/").replace(/^\.\//, ""));
}
