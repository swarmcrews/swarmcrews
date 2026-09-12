/** Move one preference on first read; new values always take precedence. */
export function readBrandPreference(storage: Storage, key: string): string | null {
  const current = storage.getItem(key);
  if (current !== null) return current;
  const legacyKey = key.replace(/^swarmcrews:/, "minions:");
  const legacy = storage.getItem(legacyKey);
  if (legacy !== null) {
    try {
      storage.setItem(key, legacy);
      storage.removeItem(legacyKey);
    } catch {
      // A read-only storage backend can still supply the saved preference.
    }
  }
  return legacy;
}

export function clearLegacyPreference(storage: Storage, key: string): void {
  storage.removeItem(key.replace(/^swarmcrews:/, "minions:"));
}
