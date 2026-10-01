/** Equivalent reads share only an outstanding reply: every socket subscriber
 * receives it. New consumers after completion, retries and switches still load. */
export class BootstrapRequests {
  private readonly outstanding = new Map<string, number>();
  private projectId: string | null | undefined;
  send(command: { type?: string; projectId?: string | null; sessionKey?: string;
    includeArchived?: boolean; afterHistoryId?: number }): boolean {
    let key: string;
    if (command.type === "list_sessions") {
      if (command.projectId !== this.projectId) this.outstanding.clear();
      this.projectId = command.projectId;
      key = `list:${command.projectId ?? ""}:${command.includeArchived === true}`;
    } else if (command.type === "sync_session" && command.sessionKey) {
      key = `sync:${command.sessionKey}:${command.afterHistoryId ?? "tail"}`;
    } else return true;
    const now = Date.now();
    for (const [pending, sentAt] of this.outstanding) if (now - sentAt >= 10_000) this.outstanding.delete(pending);
    if (this.outstanding.has(key)) return false;
    this.outstanding.set(key, now);
    return true;
  }
  received(message: { type?: string; topic?: string; includeArchived?: boolean;
    sessionKey?: string; afterHistoryId?: number; found?: boolean }): void {
    if (message.type === "session_list") {
      const projectId = message.topic?.startsWith("project:") ? message.topic.slice(8) : "";
      this.outstanding.delete(`list:${projectId}:${message.includeArchived === true}`);
    } else if (message.type === "sync_response") {
      const prefix = `sync:${message.sessionKey}:`;
      if (message.found === false) {
        for (const key of this.outstanding.keys()) if (key.startsWith(prefix)) this.outstanding.delete(key);
      } else this.outstanding.delete(`${prefix}${message.afterHistoryId ?? "tail"}`);
    }
    if (message.type === "error") this.outstanding.clear();
  }
  reset(): void { this.outstanding.clear(); }
}
