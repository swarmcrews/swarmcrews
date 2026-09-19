/** Tool IDs may restart on each resumed provider turn. Pair results in event order. */
export function toolResponseMetrics(events) {
  const names = new Map(), responses = {};
  for (const event of events) {
    const payload = event.payload;
    if (payload.kind === 'tool_call') names.set(`${event.participantId}:${payload.id}`, payload.name);
    if (payload.kind !== 'tool_result') continue;
    const key = `${event.participantId}:${payload.callId}`;
    const name = names.get(key) ?? 'unknown';
    names.delete(key);
    const bytes = Buffer.byteLength(JSON.stringify(payload.output ?? null));
    const previous = responses[name] ?? {count:0,utf8Bytes:0,maxUtf8Bytes:0};
    responses[name] = {count:previous.count+1,utf8Bytes:previous.utf8Bytes+bytes,maxUtf8Bytes:Math.max(previous.maxUtf8Bytes,bytes)};
  }
  return responses;
}
