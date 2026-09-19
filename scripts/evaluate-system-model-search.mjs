// Offline experiment only; production retrieval remains matchSystemModel.
// Run: node --import ./scripts/register-typescript.mjs scripts/evaluate-system-model-search.mjs
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { loadSystemModel } from "../server/system-model/load.ts";
import { matchSystemModel, globMatches } from "../server/system-model/match.ts";

const cases = [
  ["system model relevance lifecycle", [], "system_model_guidance"],
  ["change canonical follow-up guidance", ["server/work-item-continuation.ts"], "conversation_steering"],
  ["fix scheduler retry recovery", ["server/task-graph/scheduler.ts"], "execution_graph_runtime"],
  ["canvas zoom and pan", ["src/CanvasMiniMap.tsx"], "spatial_canvas"],
  ["mobile push notifications", ["src/mobile/push.ts"], "mobile_remote_control"],
  ["freeze skill library instructions", [], "skill_library"],
  ["open project workspace", [], "project_workspace"],
  ["render a dashboard decision form", [], "dashboard_decisions"],
  ["inspect token usage and cost", [], "execution_observability"],
  ["route connected context to agents", [], "context_routing"],
  ["run standalone agent evaluation", [], "standalone_agent_evaluation"],
  ["resume a conversation after user replies", [], "conversation_steering"],
  // Paraphrase and identifier challenges are intentionally not vocabulary-aligned.
  ["keep track of spending while workers run", [], "execution_observability"],
  ["give the worker only the reference material it needs", [], "context_routing"],
  ["work_packet freshness", [], "system_model_guidance"],
  ["executionGraphRuntime", [], "execution_graph_runtime"],
  // No modeled architecture is required for these requests.
  ["fix a typo in README", ["README.md"], null],
  ["please fix the typo in the documentation", [], null],
  ["make the button blue", [], null],
  ["correct a spelling mistake in the license", ["LICENSE"], null],
  ["translate the greeting into French", [], null],
  ["replace the sample image with a cat", [], null],
].map(([query, files, expected]) => ({ query, files, expected: expected ? `capability.${expected}` : null }));

const stop = new Set("a an and are as at be been but by can could do does for from had has have how i if in into is it its may me my of on or our please should than that the their them then there these they this those to was we were what when where which while who will with would you your fix change make add only after needs".split(" "));
const tokens = text => text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
  .split(/[^a-z0-9]+/).filter(term => term && !stop.has(term));
const { model, errors } = loadSystemModel(process.cwd());
if (!model) throw new Error(JSON.stringify(errors));
for (const item of cases) if (item.expected && !model.objectsById.has(item.expected)) throw new Error(`Missing evaluation label ${item.expected}`);
const objects = [...model.objectsById.values()].sort((a, b) => a.id.localeCompare(b.id));

function fields(object) {
  const title = object.name ?? object.title ?? object.statement ?? "";
  const auxiliary = [...(object.keywords ?? []), ...(object.steps ?? []), object.agentInstruction ?? ""].join(" ");
  return { title, auxiliary, summary: object.summary ?? "", id: object.id };
}
const docs = objects.map(object => {
  const field = fields(object);
  const terms = tokens([field.title, field.title, field.title, field.auxiliary, field.auxiliary, field.summary, field.id].join(" "));
  const counts = new Map();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  return { object, counts, length: terms.length };
});
const averageLength = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length;
const df = new Map();
for (const doc of docs) for (const term of doc.counts.keys()) df.set(term, (df.get(term) ?? 0) + 1);
const idf = term => Math.log(1 + (docs.length - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));

function prototype(query, files, bm25) {
  const terms = [...new Set(tokens(query))];
  const queryWeight = terms.reduce((sum, term) => sum + idf(term), 0);
  const candidates = docs.map(doc => {
    const hits = terms.filter(term => doc.counts.has(term));
    const lexicalScore = hits.reduce((sum, term) => {
      const tf = doc.counts.get(term);
      return sum + (bm25 ? idf(term) * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * doc.length / averageLength)) : tf);
    }, 0);
    const paths = [...(doc.object.suggestedFiles ?? []), ...(doc.object.appliesTo?.files ?? []),
      ...(doc.object.entryPoints ?? []).flatMap(entry => entry.files)];
    const fileHit = files.some(file => paths.some(glob => globMatches(glob, file)));
    const coverage = queryWeight ? hits.reduce((sum, term) => sum + idf(term), 0) / queryWeight : 0;
    return { id: doc.object.id, score: lexicalScore + (fileHit ? 12 : 0), fileHit, coverage, hits: hits.length };
  }).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 5);
  const best = candidates[0];
  // Experimental abstention rule, not a calibrated probability. Unknown query
  // terms stay in the denominator rather than vanishing from confidence.
  const confidence = best?.fileHit || (best?.hits >= 2 && best.coverage >= 0.65) ? "high"
    : best && best.coverage >= 0.35 ? "medium" : "low";
  return { candidates, matchConfidence: confidence };
}

const algorithms = {
  current: item => matchSystemModel({ model, request: item.query, files: item.files }),
  normalized_overlap: item => prototype(item.query, item.files, false),
  weighted_bm25: item => prototype(item.query, item.files, true),
};
const details = cases.map(item => ({ ...item, results: Object.fromEntries(Object.entries(algorithms).map(([name, run]) => {
  const result = run(item);
  const ids = result.candidates.map(candidate => candidate.id);
  return [name, { top3: ids.slice(0, 3), confidence: result.matchConfidence,
    expectedRank: item.expected ? (ids.indexOf(item.expected) >= 0 ? ids.indexOf(item.expected) + 1 : null) : null }];
})) }));
const positives = details.filter(item => item.expected);
const negatives = details.filter(item => !item.expected);
const summary = Object.fromEntries(Object.keys(algorithms).map(name => {
  const started = performance.now();
  for (let repeat = 0; repeat < 20; repeat++) for (const item of cases) algorithms[name](item);
  return [name, {
    targetInTop3: positives.filter(item => item.results[name].expectedRank <= 3 && item.results[name].expectedRank !== null).length,
    positives: positives.length,
    highConfidenceNegatives: negatives.filter(item => item.results[name].confidence === "high").length,
    negatives: negatives.length,
    highConfidenceMisses: positives.filter(item => item.results[name].confidence === "high" && (item.results[name].expectedRank === null || item.results[name].expectedRank > 3)).length,
    averageQueryMs: Number(((performance.now() - started) / (20 * cases.length)).toFixed(3)),
  }];
}));
console.log(JSON.stringify({ modelDigest: createHash("sha256").update(JSON.stringify(objects)).digest("hex"),
  objects: objects.length, summary, details }, null, 2));
