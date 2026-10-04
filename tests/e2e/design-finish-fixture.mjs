import {reviewPatchDiff, reviewLineagePatchDiff} from "./review-patch-fixture.mjs";
import {createGraphFixture} from "../../src/task-graph/fixtures.ts";
// Isolated visual fixture: no real sessions, projects, or provider calls.
export async function openDesignFinishFixture(page, { assistantText, nodes = [], edges = [], lineage = null } = {}) {
  const project = {
    id: "layout-review", workspaceId: "layout-review", name: "Layout Review",
    path: "C:/sample/layout-review", sourceRoot: "C:/sample/layout-review",
    hasSidecar: true, lastOpened: new Date().toISOString(), nodes, graph: { edges },
    transform: { x: 0, y: 0, scale: 1 }, settings: {}, skills: [],
  };
  const titles = [
    "Improve responsive layouts across laptop screens",
    "Review authentication changes and session recovery",
    "Simplify workspace navigation", "Update onboarding and help content",
    "Verify deployment configuration", "Review pending API changes",
  ];
  const sessions = titles.map((taskName, i) => ({
    workItemId: i === 0 ? "audit-work" : undefined, sessionKey: `layout-${i}`, sessionId: null, role: "leader",
    cwd: project.path, projectId: project.id,
    status: i === 0 ? "waiting" : i < 4 ? "running" : "stopped",
    taskName, model: "gpt-6", harnessId: "codex", totalCost: 1.24 + i,
    createdAt: Date.now() - 3600000, lastActivityAt: Date.now() - i * 60000,
  }));
  const workItem = { id: 'audit-work', projectId: project.id, projectPath: project.path,
    title: titles[0], currentRunKey: 'layout-0', iteration: 1, waitKind: 'decision',
    lifecycle: { runtimeState: 'waiting', outcome: 'none', resolution: 'open', changeMode: 'worktree',
      integrationState: 'worktree_active', lifecycleRevision: 1 }, lastTransitionAt: 1, createdAt: 1, updatedAt: 1 };
  const harnesses = [{
    name: "claude", models: [{ id: "claude-opus-4-8", label: "Opus" }],
    builtInTools: [], commands: [], agents: [], account: { provider: "anthropic" },
    capabilities: {
      mutationInterception: "complete", thinking: true, promptCaching: true,
      mcp: true, permissionPrompts: true, resume: true,
      partialMessages: true, builtInFilesystem: true,
    },
  }];

  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let json = {};
    if (path.endsWith("/auth/token")) json = { token: "layout-test" };
    else if (path === "/api/projects") json = [project];
    else if (path === `/api/projects/${project.id}`) json = project;
    else if (path === "/api/readiness") json = { harnesses: [] };
    else if (path.endsWith('/mcp-servers')) json = { entries: [], invalid: [], statuses: {} };
    else if (path.includes("skills")) json = [];
    else if (path.includes("context")) json = { content: "" };
    return route.fulfill({ json });
  });
  let diffFailure = false;
  const commands = [];
  let sendEvent;
  let inventoryTopic = "global";
  await page.routeWebSocket("**/ws*", (socket) => socket.onMessage((raw) => {
    const message = JSON.parse(raw);
    commands.push(message);
    if (message.type === "list_sessions") inventoryTopic = message.projectId ? `project:${message.projectId}` : "global";
    const send = (data) => socket.send(JSON.stringify({
      topic: data.sessionKey ? `session:${data.sessionKey}` : data.type === "session_list" ? inventoryTopic : "global", ...data,
    }));
    sendEvent = send;
    // Inventory replies follow the selected project, just like listSessions.
    // A global reply is stale once the client has switched into a project.
    if (message.type === "list_sessions") send({ type: "session_list", sessions,
      topic: message.projectId ? `project:${message.projectId}` : "global",
      includeArchived: message.includeArchived === true });
    if (message.type === "list_harnesses") send({ type: "harness_list", harnesses });
    if (message.type === "sync_session") {
      const sessionKey = message.sessionKey;
      send({
        type: "sync_response", sessionKey, found: true, status: "waiting", totalCost: 1.24, turns: 3, taskName: sessions.find(s=>s.sessionKey===sessionKey)?.taskName, model: "gpt-6", harness: "codex", permissionMode: "auto",
        ...(lineage ? { workItemId: "audit-work", runKey: sessionKey, worktree: { path: "C:/sample/worktree", branch: "audit/worktree", lifecycle: "active" } } : {}),
        renderState: {layout:{title:"Release readiness",columns:2},components:[{id:"progress",type:"progress",label:"Verification",value:67},{id:"status",type:"status",label:"Review",state:"warning"},{id:"tasks",type:"table",headers:["Task","Owner","State"],rows:[["Authentication recovery","Leader","Needs approval"],["Responsive layout","Crew","Passed"]]},{id:"decision",type:"form",title:"Choose the next step",fields:[{id:"decision",label:"Review decision",kind:"select",required:true,options:["Continue","Revise"]}]}]},
        events: [
          { type: "sdk_event", sessionKey, event: { kind: "text", role: "user",
            text: "Review the layout on laptop screens. Keep the conversation easy to read." } },
          { type: "sdk_event", sessionKey, event: { kind: "text", role: "assistant",
            text: assistantText ?? Array.from({ length: 18 }, (_, i) =>
              `${i + 1}. Keep supporting information accessible and preserve room for the conversation. Verify controls, keyboard access, and scrolling at smaller sizes.`,
            ).join("\n\n") } },
        ],
      });
    }
    if (message.type === "get_task_graph_snapshot") { const snapshot=createGraphFixture(10);send({topic:"work-item:audit-work",type:"task_graph_snapshot",cause:"audit-fixture",workItemId:"audit-work",snapshot,runId:snapshot.graphRunId,revision:snapshot.revision,timestamp:Date.now()}); }
    if (message.type === "get_worktree_diff") send({ type: "control_response", command: message.type,
      sessionKey: message.sessionKey, requestId: message.requestId,
      ...(diffFailure ? { success: false, error: "Fixture: capture failed; prior evidence retained" }
        : { success: true, diff: reviewPatchDiff(message.sessionKey, lineage?.contributions[0]) }) });
    if (message.type === "get_integration_review_diff") {
      const entry = lineage?.contributions.find(c => c.id === message.contributionId);
      send({ topic: `lineage:${message.lineageId}`, type: "integration_review_diff_response",
        lineageId: message.lineageId, contributionId: message.contributionId ?? null, requestId: message.requestId,
        ...(diffFailure ? { success: false, code: "internal", error: "Fixture: capture failed; prior evidence retained" }
          : { success: true, diff: entry ? reviewPatchDiff(entry.runKeys.at(-1), entry) : reviewLineagePatchDiff(lineage) }) });
    }
    if (message.type === "get_worktree_lineage_status") send({ topic: "work-item:audit-work", type: "worktree_integration_response", command: message.type, requestId: message.requestId, success: true, result: lineage });

    if (message.type === "get_work_item" && lineage) send({ topic: "work-item:audit-work", type: "work_item_response",
      command: message.type, requestId: message.requestId, success: true,
      result: { workItem, bindings: [], currentRun: null, runs: [], nextCursor: null, integration: lineage } });
    if (message.type === "list_work_items") send({
      type: "work_item_response", command: message.type, requestId: message.requestId,
      success: true, result: { projectId: project.id, items: lineage ? [workItem] : [], nextCursor: null },
    });
  }));

  await page.goto("/");
  await page.getByText("Layout Review", { exact: true }).click();
  await page.locator(".act-main").waitFor();
  await page.getByTestId("leader-loading").waitFor({ state: "hidden" });
  await page.evaluate(() => document.fonts.ready);
  return { send: (event) => sendEvent(event), commands, failDiff: (fail) => { diffFailure = fail; },
    updateLineage: next => { lineage = next; sendEvent({ topic: `lineage:${next.id}`, type: 'worktree_integration_changed',
      lineage: next, operation: 'fixture-revision', workItemId: 'audit-work', timestamp: Date.now() }); } };
}
