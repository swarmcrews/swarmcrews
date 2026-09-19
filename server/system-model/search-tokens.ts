// Keep query normalization and bounded concept expansion identical across object types.
const STOP_WORDS = new Set(("a an and are as at be been but by can could do does for from had has have how i if in into is it its "
  + "may me my of on or our please should than that the their them then there these they this those to was we were what when "
  + "where which while who will with would you your fix change make add only after needs").split(" "));

function stem(term: string): string {
  if (term.length > 5 && term.endsWith("ies")) return term.slice(0, -3) + "y";
  if (term.length > 5 && term.endsWith("ing")) {
    let value = term.slice(0, -3);
    if (/([b-df-hj-np-tv-z])\1$/.test(value)) value = value.slice(0, -1);
    return value;
  }
  if (term.length > 4 && term.endsWith("ed")) return term.slice(0, -2);
  if (term.length > 4 && term.endsWith("s") && !/(ss|us|is)$/.test(term)) return term.slice(0, -1);
  return term;
}

export function searchTokens(text: string): string[] {
  return text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/)
    .filter(term => term && !STOP_WORDS.has(term)).map(stem);
}

const CONCEPTS = [
  ["spending", "expense", "cost", "usage", "consumption"],
  ["worker", "agent", "minion"],
  ["reference", "material", "context", "knowledge"],
  ["relevant", "relevance", "pertinent"],
  ["route", "routing", "deliver", "delivery", "distribute"],
  ["observe", "monitor", "track", "inspect"],
  ["reply", "response", "answer"],
  ["resume", "continue", "continuation"],
  ["freeze", "frozen", "immutable"],
  ["notification", "alert"],
  ["recover", "recovery", "restore"],
].map(group => [...new Set(group.flatMap(searchTokens))]);

export const SEARCH_ALIASES = new Map(CONCEPTS.flatMap(group =>
  group.map(term => [term, group.filter(other => other !== term)] as const)));
