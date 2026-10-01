/** Show the runtime-reported model ID, not a version guessed from a display name.
 * The ID may still be an alias when the provider does not report a concrete ID. */
export function modelVersionLabel(id: string, displayName?: string): string {
  const name = displayName?.trim();
  return name && name !== id ? `${name} (${id})` : id;
}
