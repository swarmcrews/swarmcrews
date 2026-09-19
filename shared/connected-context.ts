/** Shared wire format for complete snapshots and incremental source updates. */
export interface ConnectedSource {
  nodeId: string;
  nodeType: string;
  label: string;
  content: string;
  attachments?: readonly { kind: string; filename?: string; mediaType: string; data: string }[] | undefined;
  /**
   * Server-validated identity for a full Leader-to-Leader graph handoff. It is
   * deliberately separate from prose so graph reads cannot be granted by an
   * identifier mentioned in a transcript.
   */
  leaderGraphSource?: { workItemId: string; primaryRunKey: string } | undefined;
}

export function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

/** Hash actual image bytes as well as text; equal byte lengths are not identity. */
export function attachmentContentHash(item: ConnectedSource): number {
  return hashString(JSON.stringify(item.attachments ?? []));
}

export function itemContentHash(item: ConnectedSource): number {
  return hashString(JSON.stringify([item.label, item.nodeType, item.content,
    item.leaderGraphSource, attachmentContentHash(item)]));
}

/** Preserve graph order, with the first occurrence of each source authoritative. */
export function uniqueContextSources<T extends ConnectedSource>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.nodeId)) return false;
    seen.add(item.nodeId);
    return true;
  });
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function contextAttribute(attributes: string, name: "source-id" | "title"): string | undefined {
  const value = attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
  return value?.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export function renderContextGroup(item: ConnectedSource, update?: string, version = itemContentHash(item)): string {
  const attrs = `source-id="${escapeAttribute(item.nodeId)}" source-type="${escapeAttribute(item.nodeType)}" title="${escapeAttribute(item.label)}" version="${version}"`;
  // Source documents can themselves contain our wire tags. Escape their text
  // so it cannot terminate a group, masquerade as an update, or corrupt excerpts.
  const content = item.content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<context-group ${attrs}${update ? ` update="${update}"` : ""}>\n${content}\n</context-group>`;
}

export function contextAttachmentHint(items: readonly ConnectedSource[]): string {
  const count = items.reduce((n, item) => n + (item.attachments?.length ?? 0), 0);
  return count ? `\n\nThe user has also attached ${count} image${count === 1 ? "" : "s"} — see the image block${count === 1 ? "" : "s"} in this turn. Images follow source-group order.` : "";
}

/** This wrapper also identifies a complete snapshot to continuity capture. */
export function buildConnectedContextBlock(sources: readonly ConnectedSource[]): string | null {
  const items = uniqueContextSources(sources);
  if (!items.length) return null;
  return `<connected-context>\nThe following context has been provided by the user via connected canvas nodes:\n\n${items.map(item => renderContextGroup(item)).join("\n")}${contextAttachmentHint(items)}\n</connected-context>`;
}
