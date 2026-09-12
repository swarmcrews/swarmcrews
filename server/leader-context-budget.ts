import { boundHandoffText } from "../shared/handoff-text.ts";
import { persistContextSource } from "./context-source.ts";

export const LEADER_CONTEXT_BUDGET = 24_000;
export const LEADER_SOURCE_BUDGET = 8_000;
const contextPattern = () => /<(connected-context(?:-update)?)>([\s\S]*?)<\/\1>/g;
const groupPattern = () => /(<context-group\b[^>]*>)([\s\S]*?)(<\/context-group>)/g;

/** Bound only reference material; the user's request and instructions stay intact. */
export function boundLeaderContext(text: string, projectPath: string): string {
  const blocks = [...text.matchAll(contextPattern())];
  if (!blocks.length) return text;
  const groups = blocks.flatMap(block => [...block[2]!.matchAll(groupPattern())]);
  if (blocks.reduce((n, block) => n + block[0].length, 0) <= LEADER_CONTEXT_BUDGET
    && groups.every(group => group[0].length <= LEADER_SOURCE_BUDGET)) return text;

  const full = blocks.map(block => block[0]).join("\n\n");
  const ref = persistContextSource(projectPath, full);
  // Do not silently discard evidence if durable source storage is unavailable.
  if (!ref) throw new Error("Cannot bound Leader context without a readable full source in the workspace registry");
  const footer = `\n[Context excerpt: material omitted. Read the full source before relying on omitted requirements or source changes.]\nFull source (reference data): ${ref}\n`;
  const blockBudget = Math.floor(LEADER_CONTEXT_BUDGET / blocks.length);
  // Extremely many groups/blocks still have an exact, retrievable representation.
  if (blockBudget < footer.length + 300) {
    let emitted = false;
    return text.replace(contextPattern(), () => {
      if (emitted) return "";
      emitted = true;
      return `<connected-context-update>${footer}</connected-context-update>`;
    });
  }
  return text.replace(contextPattern(), (_original, tag: string, body: string) => {
    const matches = [...body.matchAll(groupPattern())];
    const open = `<${tag}>\n`, close = `\n</${tag}>`;
    const available = blockBudget - open.length - close.length - footer.length;
    if (!matches.length) return open + boundHandoffText(body, available) + footer + close;
    const preamble = boundHandoffText(body.slice(0, matches[0]!.index), Math.min(500, Math.floor(available / 4)));
    const perGroup = Math.min(LEADER_SOURCE_BUDGET, Math.floor((available - preamble.length) / matches.length) - 1);
    if (matches.some(group => group[1]!.length + group[3]!.length + 100 > perGroup)) {
      return open + "Source groups omitted; read their identities, versions and changes in the full source." + footer + close;
    }
    const rendered = matches.map(group => group[1]!
      + boundHandoffText(group[2]!, perGroup - group[1]!.length - group[3]!.length) + group[3]!);
    return open + preamble + rendered.join("\n") + footer + close;
  });
}

export function boundLeaderPrompt(
  prompt: string | AsyncIterable<{ role: "user"; content: string }>, projectPath: string,
): typeof prompt {
  if (typeof prompt === "string") return boundLeaderContext(prompt, projectPath);
  return (async function* () {
    for await (const message of prompt) yield { ...message, content: boundLeaderContext(message.content, projectPath) };
  })();
}
