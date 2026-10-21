import { legacyLibraryRoutes } from "./project-library-fixture.mjs";
import { expect, test } from "@playwright/test";
import { openResponsiveFixture } from "./responsive-fixture.mjs";

const approval = sessionKey => ({ id: "361cecd3-3522-4a9f-b8c8-b4268e3fca80", sessionKey,
  tool: "Bash", reason: "Run the project tests?", details: JSON.stringify({ command: "pnpm test:run", cwd: "/workspace/project" }, null, 2), expiresAt: Date.now() + 300_000 });

async function checkPanel(page, panel, info, name) {
  await expect(panel).toBeVisible();
  await expect(panel.getByText("pnpm test:run", { exact: false })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Allow once" })).toBeEnabled();
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await panel.screenshot({ path: info.outputPath(`${name}.png`) });
}

test("Activity, Canvas and fullscreen expose the same native request", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await openResponsiveFixture(page);
  await page.getByRole("button", { name: "Review request: Improve responsive layouts across laptop screens", exact: true }).click();
  fixture.send({ type: "tool_approval_snapshot", sessionKey: "layout-0", requests: [approval("layout-0")] });
  await checkPanel(page, page.getByRole("region", { name: "Tool approvals" }), info, "activity");
  await page.getByRole("button", { name: "Add to canvas", exact: true }).click();
  fixture.send({ type: "tool_approval_snapshot", sessionKey: "layout-0", requests: [approval("layout-0")] });
  const canvas = page.locator(".leader-node");
  await checkPanel(page, canvas.getByRole("region", { name: "Tool approvals" }), info, "canvas");
  await canvas.getByTestId("leader-fullscreen-enter").click();
  fixture.send({ type: "tool_approval_snapshot", sessionKey: "layout-0", requests: [approval("layout-0")] });
  const fullscreen = page.getByRole("dialog", { name: "Leader fullscreen cockpit" });
  await checkPanel(page, fullscreen.getByRole("region", { name: "Tool approvals" }), info, "fullscreen");
  await fullscreen.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(fullscreen.getByRole("button", { name: "Allow once" })).toBeDisabled();
});

for (const width of [320, 390]) test(`mobile decisions stay usable at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  const project = { id: "approval-project", path: "/workspace/approval-project", name: "Approval project", hasSidecar: true };
  const session = { sessionKey: "approval-session", role: "leader", status: "running", cwd: project.path, taskName: "Review tool approval" };
  let requests = [approval(session.sessionKey)];
  const decisions = [];
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("/auth/token") ? { token: "fixture" } : path === "/api/projects" ? [project]
      : path.includes("skills") ? [] : path === "/api/readiness" ? { harnesses: [] } : {} });
  });
  await legacyLibraryRoutes(page, [project]);
  await page.routeWebSocket("**/ws*", socket => socket.onMessage(raw => {
    const message = JSON.parse(raw);
    const send = data => socket.send(JSON.stringify({ topic: data.sessionKey ? `session:${data.sessionKey}` : "global", ...data }));
    if (message.type === "list_sessions") send({ type: "session_list", topic: message.projectId ? `project:${message.projectId}` : "global", sessions: [session] });
    if (message.type === "list_harnesses") send({ type: "harness_list", harnesses: [] });
    if (message.type === "list_work_items") send({ type: "work_item_response", command: message.type, requestId: message.requestId, success: true, result: { items: [], nextCursor: null } });
    if (message.type === "get_tool_approvals") send({ type: "tool_approval_snapshot", sessionKey: session.sessionKey, requests });
    if (message.type === "sync_session") send({ type: "sync_response", ...session, found: true, events: [], toolApprovals: requests });
    if (message.type === "respond_tool_approval") { decisions.push(message); requests = [];
      send({ type: "tool_approval_snapshot", sessionKey: session.sessionKey, requests }); }
  }));
  await page.goto("/m");
  await page.getByRole("button", { name: /Approval project/ }).click();
  await page.getByRole("button", { name: /Review tool approval/ }).click();
  const panel = page.getByRole("region", { name: "Tool approvals" });
  await checkPanel(page, panel, info, `mobile-${width}`);
  await page.screenshot({ path: info.outputPath(`mobile-full-${width}.png`) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await panel.getByRole("button", { name: "Allow once" }).click();
  await expect(panel).toBeHidden();
  expect(decisions).toHaveLength(1);
  expect(decisions[0]).toMatchObject({ sessionKey: session.sessionKey, approvalId: approval(session.sessionKey).id, approvalDecision: "allow_once" });
});
