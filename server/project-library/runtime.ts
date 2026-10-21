import type { ProjectActivitySummary } from "../../shared/project-activity.ts";

// Server-only evidence accompanies the exact freshly computed snapshot objects.
// Never trust client JSON, historical persistence or a bare count-only adapter as
// proof that every live host was inspected. The legacy badge wire contract stays unchanged.
const evidence = new WeakMap<ProjectActivitySummary, { known: boolean; activeOther: number; runningLeaders: number; runningOther: number; archiveBlocked?: boolean }>();
export function withLibraryRuntimeEvidence<T extends ProjectActivitySummary>(summary: T, activeOther: number, known = true,
  running: { leaders: number; other: number } = { leaders: 0, other: 0 }, archiveBlocked = false): T {
  evidence.set(summary, { known, activeOther, runningLeaders: running.leaders, runningOther: running.other, ...(archiveBlocked ? { archiveBlocked: true } : {}) }); return summary;
}
export function libraryRuntimeEvidence(summary: ProjectActivitySummary | undefined) {
  return summary ? evidence.get(summary) : undefined;
}
