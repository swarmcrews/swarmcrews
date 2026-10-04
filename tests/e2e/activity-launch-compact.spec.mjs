import { openResponsiveFixture } from "./responsive-fixture.mjs";
import { openProjectFixture } from "./project-fixture.mjs";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

async function expectCommandPopoverAbove(prompt, menu, viewportHeight) {
  await expect(menu).toBeVisible();
  await expect(prompt.getByRole("listbox", { name: "Leader context shortcuts" })).toHaveCount(0);
  const [promptBounds, menuBounds] = await Promise.all([
    prompt.boundingBox(),
    menu.boundingBox(),
  ]);
  expect(promptBounds).not.toBeNull();
  expect(menuBounds).not.toBeNull();
  expect(menuBounds.y + menuBounds.height).toBeLessThan(promptBounds.y);
  expect(menuBounds.y).toBeGreaterThanOrEqual(0);
  expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(viewportHeight);
}

test("keeps New Leader configuration and popovers contained", async ({ page }) => {
  await page.route(/https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/, (route) =>
    route.abort(),
  );
  await openProjectFixture(page, "Activity Launch");

  const addAgent = page.getByRole("region", { name: "Add an agent" });
  await expect(addAgent).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 520 });
  const emptyPrompt = addAgent.locator(".leader-launch-prompt");
  await addAgent.getByLabel("Leader prompt", { exact: true }).fill("/");
  const emptyCommandMenu = page.getByRole("listbox", { name: "Leader context shortcuts" });
  await expectCommandPopoverAbove(emptyPrompt, emptyCommandMenu, 520);
  await page.keyboard.press("Escape");
  await expect(emptyCommandMenu).toBeHidden();

  await page.setViewportSize({ width: 1440, height: 900 });
  await addAgent.getByLabel("Leader prompt", { exact: true }).fill(
    "Create a small baseline session for the Activity launch test.",
  );
  await addAgent.getByRole("button", { name: "Launch leader" }).click();
  const newLeader = page.getByRole("button", { name: "New", exact: true });
  await expect(newLeader).toBeEnabled();

  await newLeader.click();
  const launchPanel = page.getByRole("region", { name: "New leader" });
  await expect(launchPanel).toBeVisible();

  const settings = launchPanel.getByRole("complementary", { name: "Run setup" });
  await expect(settings.getByText("Run configuration")).toBeVisible();
  await expect(settings.locator(".leader-launch-advanced")).not.toHaveAttribute("open");
  await expect(settings.getByRole("region", { name: "Launch summary" })).toBeVisible();
  await settings.locator(".leader-launch-advanced > summary").click();
  await expect(settings.getByRole("checkbox", { name: "Isolated worktree" })).not.toBeChecked();
  await expect(settings.getByRole("button", { name: "Model", exact: true })).toBeVisible();
  await expect(settings.getByRole("checkbox", { name: "Isolated worktree" })).toBeVisible();
  await expect(settings.getByText("Skills", { exact: true })).toBeVisible();
  await settings.getByRole("checkbox", { name: /System Model Authoring/i }).click();
  await expect(settings.getByRole("region", { name: "Skills" })).toContainText("1 selected");

  // Run setup can legitimately scroll as settings and skills grow. Verify the
  // controls remain reachable instead of pinning which nested panel scrolls.
  const lastSetting = settings.getByRole("checkbox").last();
  await lastSetting.scrollIntoViewIfNeeded();
  await expect(lastSetting).toBeInViewport();

  const prompt = launchPanel.locator(".leader-launch-prompt");
  await launchPanel.getByLabel("Leader prompt", { exact: true }).fill("/");
  const commandMenu = page.getByRole("listbox", { name: "Leader context shortcuts" });
  await expectCommandPopoverAbove(prompt, commandMenu, 900);
  await page.keyboard.press("Escape");
  await expect(commandMenu).toBeHidden();

  await launchPanel.getByLabel("Leader prompt", { exact: true }).fill(
    "Create a contained Activity launch experience.",
  );
  await expect(launchPanel.getByRole("button", { name: "Launch leader" })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 720 });
  const launch = launchPanel.getByRole("button", { name: "Launch leader" });
  await launch.scrollIntoViewIfNeeded();
  await expect(launch).toBeInViewport();
  await expect(launch).toBeEnabled();
  await lastSetting.scrollIntoViewIfNeeded();
  await expect(lastSetting).toBeInViewport();

  await page.setViewportSize({ width: 1440, height: 520 });
  await launchPanel.getByLabel("Leader prompt", { exact: true }).fill("/");
  const shortCommandMenu = page.getByRole("listbox", { name: "Leader context shortcuts" });
  await expectCommandPopoverAbove(prompt, shortCommandMenu, 520);
});


test("Activity launch uses the full model picker at desktop and narrow widths", async ({ page }, info) => {
  const fixture = await openResponsiveFixture(page);
  fixture.send({ type: "harness_list", harnesses: [
    { name: "claude", models: [{ id: "opus", label: "Opus" }],
      capabilities: { thinking: true, permissionPrompts: true },
      builtInTools: [], commands: [], agents: [], account: { provider: "anthropic" } },
    { name: "codex", models: [{ id: "gpt-6-astra", label: "GPT-6 Astra" }],
      capabilities: { thinking: true, permissionPrompts: true },
      builtInTools: [], commands: [], agents: [], account: { provider: "openai" } },
  ] });
  await page.getByRole("button", { name: "New", exact: true }).click();
  const panel = page.getByRole("region", { name: "New leader" });
  const trigger = panel.getByRole("button", { name: "Model", exact: true });
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await trigger.click();
    const picker = panel.getByRole("dialog", { name: "Model menu" });
    await expect(picker).toBeVisible();
    await picker.getByRole("tab", { name: /OpenAI/ }).click();
    await picker.getByRole("button", { name: /GPT-6 Astra/ }).click();
    await picker.getByRole("button", { name: "Max", exact: true }).click();
    await expect(trigger).toContainText("GPT-6 Astra");
    await expect(trigger).toContainText("Max");
    const bounds = await picker.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await picker.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await picker.screenshot({ path: info.outputPath(`model-picker-${width}.png`) });
    await trigger.focus();
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(panel).toBeVisible();
  }
});
