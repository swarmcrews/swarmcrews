/** Invocation-only authorization. Never a session grant or Git change approval. */
export type ToolApprovalDecision = "allow_once" | "deny";
export interface ToolApprovalInput {
  tool: string;
  input: unknown;
  reason?: string;
}
export interface ToolApprovalRequest {
  id: string;
  sessionKey: string;
  tool: string;
  /** Bounded, display-only JSON. Never used to execute the approved action. */
  details: string;
  reason: string;
  expiresAt: number;
}
export type RequestToolApproval = (request: ToolApprovalInput, signal?: AbortSignal) => Promise<ToolApprovalDecision>;
export interface ToolApprovalSnapshot {
  type: "tool_approval_snapshot";
  sessionKey: string;
  requests: ToolApprovalRequest[];
}
