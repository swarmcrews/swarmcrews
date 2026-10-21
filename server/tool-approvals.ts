import { randomUUID } from "node:crypto";
import type { RequestToolApproval, ToolApprovalDecision, ToolApprovalRequest, ToolApprovalSnapshot } from "../shared/tool-approval.ts";

const TIMEOUT_MS = 5 * 60_000;
const MAX_PENDING = 32;
interface Pending {
  request: ToolApprovalRequest;
  settle: (decision: ToolApprovalDecision) => void;
}

/** Memory-only callbacks: reconnect can observe live requests; restart cannot revive them. */
export class ToolApprovals {
  private pending = new Map<string, Pending>();
  private invocation: { signal: AbortSignal; close: () => void } | null = null;
  private emit: (event: ToolApprovalSnapshot) => void = () => {};
  constructor(private readonly sessionKey: string) {}

  begin(signal: AbortSignal, emit: (event: ToolApprovalSnapshot) => void): RequestToolApproval {
    this.end();
    this.emit = emit;
    const invocation = { signal, close: () => this.end(signal) };
    this.invocation = invocation;
    signal.addEventListener("abort", invocation.close, { once: true });
    return (input, nativeSignal) => {
      if (this.invocation !== invocation || signal.aborted || nativeSignal?.aborted || this.pending.size >= MAX_PENDING) {
        return Promise.resolve("deny");
      }
      const details = displayDetails(input.input);
      if (details === null || input.tool.length > 200) return Promise.resolve("deny");
      const id = randomUUID();
      const request: ToolApprovalRequest = {
        id, sessionKey: this.sessionKey, tool: input.tool.slice(0, 200),
        details, reason: (input.reason ?? "The tool needs your permission.").slice(0, 1000),
        expiresAt: Date.now() + TIMEOUT_MS,
      };
      return new Promise(resolve => {
        const cancel = () => settle("deny");
        const timer = setTimeout(cancel, TIMEOUT_MS);
        timer.unref?.();
        const settle = (decision: ToolApprovalDecision) => {
          if (!this.pending.delete(id)) return;
          clearTimeout(timer);
          nativeSignal?.removeEventListener("abort", cancel);
          resolve(decision);
          this.publish();
        };
        this.pending.set(id, { request, settle });
        nativeSignal?.addEventListener("abort", cancel, { once: true });
        this.publish();
      });
    };
  }

  snapshot(): ToolApprovalRequest[] {
    for (const entry of this.pending.values()) {
      if (entry.request.expiresAt <= Date.now()) entry.settle("deny");
    }
    return Array.from(this.pending.values(), entry => ({ ...entry.request }));
  }

  decide(id: string, decision: ToolApprovalDecision): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    if (!this.invocation || this.invocation.signal.aborted || entry.request.expiresAt <= Date.now()) {
      entry.settle("deny");
      return false;
    }
    entry.settle(decision);
    return true;
  }

  end(signal?: AbortSignal): void {
    if (signal && this.invocation?.signal !== signal) return;
    const invocation = this.invocation;
    this.invocation = null;
    invocation?.signal.removeEventListener("abort", invocation.close);
    for (const entry of this.pending.values()) entry.settle("deny");
  }

  private publish(): void {
    // No persistence/transcript replay: actionability belongs to these callbacks only.
    this.emit({ type: "tool_approval_snapshot", sessionKey: this.sessionKey,
      requests: Array.from(this.pending.values(), entry => ({ ...entry.request })) });
  }
}

function displayDetails(input: unknown): string | null {
  // Never authorize executable content that was omitted from the decision UI.
  try {
    const details = JSON.stringify(input, null, 2);
    return details !== undefined && details.length <= 12_000 ? details : null;
  } catch { return null; }
}
