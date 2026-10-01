import type { AgentTypeContext } from "./types.ts";
import type { TaskManagerState } from "../task-tools.ts";
import type { RenderState } from "../render-tools.ts";
import { persistRenderState, persistTaskState } from "../session-persist.ts";
import { findUnansweredForms } from "../../shared/render-dsl.ts";

export function createLeaderStateCallbacks(ctx: AgentTypeContext, sessionKey: string) {
  let currentTaskState: TaskManagerState | undefined;
  let currentRenderState: RenderState | undefined;
  return {
    onTaskStateChange(state: TaskManagerState): void {
      currentTaskState = state;
      persistTaskState(sessionKey, state);
      if (state.approval?.requested) {
        ctx.markDecisionNeeded?.(state.approval.summary || "Review and approve changes",
          () => currentTaskState?.approval?.requested === true);
      }
    },
    onRenderStateChange(state: RenderState): void {
      currentRenderState = state;
      persistRenderState(sessionKey, state);
      ctx.markDashboardChanged?.();
      if (findUnansweredForms(state.components).length > 0) {
        ctx.markDecisionNeeded?.("Dashboard input requested",
          () => findUnansweredForms(currentRenderState?.components ?? []).length > 0);
      }
    },
  };
}
