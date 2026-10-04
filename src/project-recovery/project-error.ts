/** Translate the existing API error boundary, without hiding the server's reason. */
export function projectErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/^(Failed to fetch|fetch failed|NetworkError.*|Network request failed)$/i.test(message)) {
    return "Couldn’t reach the server. Check your connection and that Swarmcrews is running, then retry.";
  }
  const api = /^API error (\d+): ([\s\S]*)$/.exec(message);
  if (!api) return message;
  const status = api[1];
  let detail = "";
  try {
    const body: unknown = JSON.parse(api[2]!);
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") detail = body.error;
  } catch { /* Proxy HTML is not useful recovery copy. */ }
  if (!detail) detail = status === "404" ? "This project is unavailable on the server. Return to Projects to reopen its folder." : "The server couldn’t complete this request. Check the server and retry.";
  return `${detail} (HTTP ${status})`;
}
