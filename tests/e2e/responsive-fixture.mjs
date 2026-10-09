// Isolated visual fixture: no real sessions, projects, or provider calls.
export async function openResponsiveFixture(page, { assistantText, nodes = [], edges = [], skills = [] } = {}) {
  const project = {
    id: "layout-review", workspaceId: "layout-review", name: "Layout Review",
    path: "C:/sample/layout-review", sourceRoot: "C:/sample/layout-review",
    hasSidecar: true, lastOpened: new Date().toISOString(), nodes, graph: { edges },
    transform: { x: 0, y: 0, scale: 1 }, settings: {}, skills,
  };
  const titles = [
    "Improve responsive layouts across laptop screens",
    "Review authentication changes and session recovery",
    "Simplify workspace navigation", "Update onboarding and help content",
    "Verify deployment configuration", "Review pending API changes",
  ];
  const sessions = titles.map((taskName, i) => ({
    sessionKey: `layout-${i}`, sessionId: null, role: "leader",
    cwd: project.path, projectId: project.id,
    status: i === 0 ? "waiting" : i < 4 ? "running" : "stopped",
    taskName, model: "gpt-6", harnessId: "codex", totalCost: 1.24 + i,
    createdAt: Date.now() - 3600000, lastActivityAt: Date.now() - i * 60000,
  }));
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
    else if (path.includes("skills")) json = skills;
    else if (path.includes("context")) json = { content: "" };
    return route.fulfill({ json });
  });
  let sendEvent;
  let inventoryTopic = "global";
  await page.routeWebSocket("**/ws*", (socket) => socket.onMessage((raw) => {
    const message = JSON.parse(raw);
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
        type: "sync_response", sessionKey, found: true, status: "waiting", totalCost: 1.24, turns: 3,
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
    if (message.type === "list_work_items") send({
      type: "work_item_response", command: message.type, requestId: message.requestId,
      success: true, result: { projectId: project.id, items: [], nextCursor: null },
    });
  }));

  await page.goto("/");
  await page.getByText("Layout Review", { exact: true }).click();
  await page.locator(".act-main").waitFor();
  await page.getByTestId("leader-loading").waitFor({ state: "hidden" });
  await page.evaluate(() => document.fonts.ready);
  return { send: (event) => sendEvent(event) };
}
