import { CLAUDE_MODEL_POLICY, setClaudeModels } from "../../server/harness/claude/models.ts";
import { CODEX_MODEL_POLICY, setCodexModels } from "../../server/harness/codex/models.ts";

/** Tests that supply ready snapshots must also supply the discovered catalogs. */
export function seedNativeModelCatalogs(): void {
  setClaudeModels(CLAUDE_MODEL_POLICY.leader.map(value => ({ value, displayName: value, description: "" })));
  setCodexModels(CODEX_MODEL_POLICY.leader.map(model => ({ model, displayName: model })));
}

export function clearNativeModelCatalogs(): void {
  setClaudeModels([]);
  setCodexModels([]);
}
