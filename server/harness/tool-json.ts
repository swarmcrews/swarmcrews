/**
 * Snapshot the supported JSON data profile without invoking getters/toJSON.
 * Plain/null-prototype records and dense arrays only; reject hidden/symbol
 * properties, accessors, cycles, non-finite numbers and negative zero. Bound
 * nesting to 100 levels. Repeated references are copied, not treated as cycles.
 */
export function snapshotJsonObject(value: unknown): Record<string, unknown> {
  const ancestors = new Set<object>();
  const invalid = (): never => { throw new Error("Unsupported JSON data"); };
  const visit = (item: unknown, depth: number): unknown => {
    if (depth > 100) return invalid();
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number") return Number.isFinite(item) && !Object.is(item, -0) ? item : invalid();
    if (!item || typeof item !== "object" || ancestors.has(item)) return invalid();
    const array = Array.isArray(item);
    if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype)
      && !(Object.getPrototypeOf(item) === null && !array)) return invalid();
    ancestors.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(item);
    if (array && keys.length !== item.length + 1) return invalid();
    const entries: Array<[string, unknown]> = [];
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string") return invalid();
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !("value" in descriptor)) return invalid();
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)) return invalid();
      entries.push([key, visit(descriptor.value, depth + 1)]);
    }
    ancestors.delete(item);
    return array ? entries.map(([, child]) => child) : Object.fromEntries(entries);
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return visit(value, 0) as Record<string, unknown>;
}
