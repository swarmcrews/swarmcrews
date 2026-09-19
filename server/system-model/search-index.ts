import type { SystemModelObject } from "../../shared/system-model/index.ts";
import { SEARCH_ALIASES, searchTokens } from "./search-tokens.ts";

type PathMatcher = (pattern: string, file: string) => boolean;
interface SearchDocument {
  object: SystemModelObject;
  terms: Map<string, number>;
  length: number;
  paths: string[];
}
export interface SearchRow {
  id: string;
  type: SystemModelObject["type"];
  parent: string | undefined;
  score: number;
  baseScore: number;
  direct: number;
  expanded: number;
  reasons: string[];
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/\/+/g, "/");
}

function document(object: SystemModelObject): SearchDocument {
  const terms = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const term of searchTokens(text)) terms.set(term, (terms.get(term) ?? 0) + weight);
  };
  add(object.id.replace(/^[^.]+\./, ""), 1.5);
  add("name" in object ? object.name : "title" in object ? object.title : "", 3);
  add("keywords" in object ? object.keywords.join(" ") : "", 2);
  add([
    "summary" in object ? object.summary : "",
    "statement" in object ? object.statement : "",
    "agentInstruction" in object ? object.agentInstruction : "",
    "mitigation" in object ? object.mitigation : "",
    ...("steps" in object ? object.steps : []),
  ].filter(Boolean).join(" "), 1);
  const entries = "entryPoints" in object ? object.entryPoints ?? [] : [];
  for (const entry of entries) add(entry.summary ?? "", 0.4);
  // Path evidence is deliberately separate from lexical text: indexing path tokens
  // reduced retrieval quality in the controlled representation experiment.
  const paths = [...new Set([
    ...("suggestedFiles" in object ? object.suggestedFiles : []),
    ...("suggestedTests" in object ? object.suggestedTests : []),
    ...("appliesTo" in object ? object.appliesTo.files : []),
    ...entries.flatMap(entry => [...entry.files, ...entry.tests]),
    ...(object.type === "decision" && object.file ? [object.file] : []),
    ...("evidence" in object ? object.evidence.filter(path => /[\\/]/.test(path)) : []),
  ].map(normalizePath))];
  return { object, terms, length: [...terms.values()].reduce((sum, value) => sum + value, 0), paths };
}

function pathSpecificity(pattern: string, file: string): number {
  if (pattern === file && !/[*?[]/.test(pattern)) return 1;
  const literalLength = (value: string) => value.replace(/[*?[\]{}]/g, "").length;
  return Math.min(1, literalLength(pattern) / Math.max(1, file.length), literalLength(file) / Math.max(1, pattern.length));
}

export function compareSearchRows(a: Pick<SearchRow, "id" | "score">, b: Pick<SearchRow, "id" | "score">): number {
  return b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Build from the current corpus on each call; model reloads and in-place amendments
 * cannot reuse stale postings. No persistent index or external embedding service. */
export function rankSystemModel(objects: Iterable<SystemModelObject>, request: string, files: string[], globMatches: PathMatcher) {
  const docs = [...objects].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(document);
  const frequency = new Map<string, number>();
  for (const doc of docs) for (const term of doc.terms.keys()) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  const averageLength = docs.reduce((sum, doc) => sum + doc.length, 0) / (docs.length || 1);
  const idf = (term: string) => Math.log(1 + (docs.length - (frequency.get(term) ?? 0) + 0.5) / ((frequency.get(term) ?? 0) + 0.5));
  const query = [...new Set(searchTokens(request))];
  const hints = files.map(normalizePath);
  const pathMatches = hints.map(file => docs.map(doc => doc.paths.filter(pattern =>
    pattern === file || globMatches(pattern, file) || (/[*?[]/.test(file) && globMatches(file, pattern)))));
  const matchingDocumentCounts = pathMatches.map(matches => matches.filter(paths => paths.length).length);
  const rows: SearchRow[] = docs.map((doc, index) => {
    const weighted = (term: string) => {
      const value = doc.terms.get(term) ?? 0;
      return value ? idf(term) * value * 2.2 / (value + 1.2 * (0.35 + 0.65 * doc.length / (averageLength || 1))) : 0;
    };
    let score = 0, direct = 0, expanded = 0;
    for (const term of query) {
      const value = weighted(term);
      score += value;
      if (value > 0) direct++;
    }
    for (const term of query) {
      if (doc.terms.has(term)) continue;
      const value = Math.max(0, ...(SEARCH_ALIASES.get(term) ?? []).map(weighted));
      if (value > 0) { score += 0.65 * value; expanded++; }
    }
    const fileScore = pathMatches.reduce((best, matches, hintIndex) => Math.max(best,
      ...matches[index]!.map(pattern => 5 * pathSpecificity(pattern, hints[hintIndex]!)
        / Math.sqrt(Math.max(1, matchingDocumentCounts[hintIndex]!)))), 0);
    score = (score + fileScore) * (1 + 0.3 * direct / Math.max(query.length, 1));
    const reasons: string[] = [];
    if (direct) reasons.push(`text matched ${direct} query term${direct === 1 ? "" : "s"}`);
    if (expanded) reasons.push(`related concepts matched ${expanded} query term${expanded === 1 ? "" : "s"}`);
    if (fileScore > 0) {
      reasons.push("file evidence matched, weighted by path specificity and corpus overlap");
      if (doc.object.type === "capability") for (const entry of doc.object.entryPoints ?? []) {
        if (hints.some(file => [...entry.files, ...entry.tests].some(pattern => globMatches(pattern, file)))) {
          reasons.push(`file matches entry point ${entry.surface}`);
        }
      }
    }
    return { id: doc.object.id, type: doc.object.type,
      parent: doc.object.type === "flow" ? doc.object.primaryCapability : undefined,
      score, baseScore: score, direct, expanded, reasons };
  }).filter(row => row.score > 0);
  const byId = new Map(rows.map(row => [row.id, row]));
  const boosts = new Map<string, { score: number; source: string }>();
  for (const row of rows) {
    const parent = row.parent ? byId.get(row.parent) : undefined;
    if (!parent || parent.type !== "capability" || parent.direct + parent.expanded < 2 || row.direct + row.expanded < 2) continue;
    const score = Math.min(parent.baseScore * 0.4, row.baseScore * 0.35);
    if (score > (boosts.get(parent.id)?.score ?? 0)) boosts.set(parent.id, { score, source: row.id });
  }
  for (const row of rows) {
    const boost = boosts.get(row.id);
    if (boost) { row.score += boost.score; row.reasons.push(`bounded primary-capability support from ${boost.source}`); }
  }
  return { rows: rows.sort(compareSearchRows), queryTerms: query.length };
}
