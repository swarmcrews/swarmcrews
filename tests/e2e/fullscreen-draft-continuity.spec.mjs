import { test, expect } from '@playwright/test';
import { openDesignFinishFixture } from './design-finish-fixture.mjs';
import { LEADER_DEFAULT_DATA } from '../../src/nodes/leader/types.ts';

const title = 'Improve responsive layouts across laptop screens';
// All projects, catalog, sessions and commands are intercepted simulations.
async function openCockpit(page, theme) {
  const fixture = await openDesignFinishFixture(page, { nodes: [{ id: 'review', type: 'leader',
    position: { x: 100, y: 100 }, size: { width: 560, height: 600 },
    data: { ...LEADER_DEFAULT_DATA, sessionKey: 'layout-0', currentRunKey: 'layout-0',
      workItemId: 'audit-work', status: 'waiting', taskName: title } }] });
  if (theme === 'Daybook') {
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    await page.getByRole('button', { name: /^Daybook/ }).click();
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: new RegExp(title) }).first().click();
  await page.getByRole('button', { name: 'Expand fullscreen', exact: true }).click();
  const cockpit = page.getByRole('dialog', { name: 'Leader fullscreen cockpit' });
  await expect(cockpit).toContainText('gpt-6');
  return { fixture, cockpit };
}
for (const theme of ['Midnight', 'Daybook']) {
  for (const catalog of ['fallback', 'normalized']) test(`nested Escape and outer exit preserve the exact unsent guidance in ${theme} (${catalog})`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { fixture, cockpit } = await openCockpit(page, theme);
    if (catalog === 'normalized') fixture.send({ type: 'harness_list', harnesses: [{ name: 'codex',
      capabilities: { mutationInterception: 'observe_only', thinking: true, promptCaching: true, mcp: true,
        permissionPrompts: true, resume: true, partialMessages: false, builtInFilesystem: true,
        sandboxEnforcement: { filesystem: ['read-only', 'workspace-write', 'unrestricted'], approval: true } },
      models: [{ id: 'gpt-6', label: 'Astra', source: 'dynamic', supportsReasoning: true,
        supportedEffortLevels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], defaultEffortLevel: 'high' }],
      builtInTools: [], commands: [], agents: [], account: { provider: 'openai' } }] });
    const draft = 'Retain this exact unsent guidance through menu dismissal and surface changes.';
    const prompt = cockpit.getByRole('textbox', { name: 'Leader prompt', exact: true });
    await prompt.fill(draft);
    await cockpit.getByLabel('Image or text attachments').setInputFiles({ name: 'guidance.txt', mimeType: 'text/plain', buffer: Buffer.from('SIMULATED attachment context') });
    await expect(cockpit.getByText('guidance.txt', { exact: true })).toBeVisible();
    for (const [width, font] of [[1440, 16], [800, 16], [320, 16], [320, 32]]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(n => { document.documentElement.style.fontSize = `${n}px`; }, font);
      const trigger = cockpit.getByTitle('Model selection', { exact: true });
      await trigger.click();
      const menu = cockpit.getByRole('dialog', { name: 'Model selection menu' });
      await expect(menu).toBeVisible();
      if (catalog === 'normalized') await menu.getByRole('button', { name: 'Max', exact: true }).focus();
      else await menu.getByRole('button').first().focus();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(cockpit).toBeVisible();
      await expect(trigger).toBeFocused();
      await expect(prompt).toHaveValue(draft);
      const focus = await trigger.evaluate(el => {
        const r = el.getBoundingClientRect(), style = getComputedStyle(el);
        const ring = Math.max(0, parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset));
        return { visible: el.matches(':focus-visible'), left: r.left - ring, right: r.right + ring, width: innerWidth };
      });
      expect(focus.visible).toBe(true); expect(focus.left).toBeGreaterThanOrEqual(0);
      expect(focus.right).toBeLessThanOrEqual(focus.width);
      if (catalog === 'fallback') {
        const permission = cockpit.locator('button[aria-haspopup=dialog]').filter({ hasText: /^Auto/ });
        await permission.click();
        const permissions = cockpit.getByRole('dialog', { name: 'Permission selection menu' });
        await permissions.getByRole('button').first().focus();
        await page.keyboard.press('Escape');
        await expect(permissions).toHaveCount(0); await expect(permission).toBeFocused();
        await expect(cockpit).toBeVisible(); await expect(prompt).toHaveValue(draft);
        await trigger.click();
        // Normal pointer dismissal keeps the surface and does not steal focus.
        await prompt.click(); await expect(menu).toHaveCount(0); await expect(prompt).toBeFocused();
      }
      await page.screenshot({ path: info.outputPath(`nested-${width}-${font}.png`) });
      // The next Escape is outer-owned. Explicit exit can unmount the owner.
      await page.keyboard.press('Escape');
      await expect(cockpit).toHaveCount(0);
      await page.getByRole('button', { name: 'Expand fullscreen', exact: true }).click();
      await expect(prompt).toHaveValue(draft);
      await expect(cockpit.getByText('guidance.txt', { exact: true })).toBeVisible();
    }
    await cockpit.getByRole('button', { name: 'Exit fullscreen' }).click();
    await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Leader prompt', exact: true })).toHaveValue(draft);
    await page.getByRole('tab', { name: /^Activity\b/ }).click();
    await page.getByRole('button', { name: new RegExp(title) }).first().press('Enter');
    await page.getByRole('button', { name: 'Expand fullscreen', exact: true }).click();
    await expect(prompt).toHaveValue(draft);
    expect(fixture.commands.some(c => /^(set_model|set_permission_mode|send_message|continue_work_item|create_session|promote)/.test(c.type))).toBe(false);
  });

  test(`fullscreen title really ellipsizes inside its identity and still renames in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { cockpit } = await openCockpit(page, theme);
    const label = cockpit.locator('.leader-editable-title');
    const rows = [];
    for (const [width, font] of [[1440, 16], [800, 16], [320, 16], [320, 32]]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(n => { document.documentElement.style.fontSize = `${n}px`; }, font);
      rows.push(await label.evaluate((el, context) => {
        const box = el.getBoundingClientRect(), owner = el.closest('.leader-fs-identity').getBoundingClientRect(), style = getComputedStyle(el);
        return { ...context, right: box.right, ownerRight: owner.right, display: style.display,
          overflow: style.overflow, ellipsis: style.textOverflow, scroll: el.scrollWidth, client: el.clientWidth };
      }, { width, font }));
      await expect(label).toHaveAttribute('title', `${title} (double-click to rename)`);
      await page.screenshot({ path: info.outputPath(`title-${width}-${font}.png`) });
    }
    await info.attach('title-geometry', { body: JSON.stringify(rows), contentType: 'application/json' });
    for (const row of rows) {
      expect(row.right).toBeLessThanOrEqual(row.ownerRight + 1);
      expect(row.display).not.toBe('inline');
      expect(row.overflow).toBe('hidden');
      expect(row.ellipsis).toBe('ellipsis');
    }
    await label.dblclick();
    const edit = cockpit.locator('.leader-editable-title__input');
    await expect(edit).toBeFocused();
    await edit.fill('A'.repeat(160));
    await edit.press('Enter');
    await expect(label).toHaveText('A'.repeat(160));
    await expect(label).toHaveAttribute('title', `${'A'.repeat(160)} (double-click to rename)`);
    expect(await label.evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(320);
  });
}

for (const theme of ['Midnight', 'Daybook']) {
  for (const [width, font] of [[1440, 16], [320, 32]]) test(`keyboard Canvas-to-cockpit Escape owns only the active toolbar in ${theme} at ${width}px root${font}`, async ({ page }, info) => {
    // Canvas is spatial; enter via a visible wide node, then resize the actual cockpit.
    await page.setViewportSize({ width: 1440, height: 900 });
    const fixture = await openDesignFinishFixture(page, { nodes: [{ id: 'review', type: 'leader',
      position: { x: 500, y: 100 }, size: { width: 560, height: 600 },
      data: { ...LEADER_DEFAULT_DATA, sessionKey: 'layout-0', currentRunKey: 'layout-0',
        workItemId: 'audit-work', status: 'waiting', taskName: title } }] });
    if (theme === 'Daybook') {
      await page.getByRole('button', { name: 'Open settings', exact: true }).click();
      await page.getByRole('button', { name: /^Daybook/ }).click();
      await page.keyboard.press('Escape');
    }
    fixture.send({ type: 'harness_list', harnesses: [{ name: 'codex',
      models: [{ id: 'gpt-6', label: 'Astra', supportsReasoning: true,
        supportedEffortLevels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], defaultEffortLevel: 'high' }],
      builtInTools: [], commands: [], agents: [], account: { provider: 'openai' }, capabilities: {
        mutationInterception: 'observe_only', thinking: true, promptCaching: true, mcp: true,
        permissionPrompts: true, resume: true, partialMessages: false, builtInFilesystem: true,
        sandboxEnforcement: { filesystem: ['read-only', 'workspace-write', 'unrestricted'], approval: true },
      } }] });
    await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
    const root = page.locator('.leader-node').first();
    const draft = 'Keep this keyboard transition draft and its attachment on the same target.';
    await root.getByRole('textbox', { name: 'Leader prompt', exact: true }).fill(draft);
    await root.getByLabel('Image or text attachments').setInputFiles({ name: 'keyboard-context.txt', mimeType: 'text/plain', buffer: Buffer.from('SIMULATED context') });
    await expect(root.getByText('keyboard-context.txt', { exact: true })).toBeVisible();
    await root.getByRole('button', { name: 'Model selection', exact: true }).click();
    await expect(root.getByRole('dialog', { name: 'Model selection menu' })).toContainText('Astra');
    await page.keyboard.press('Control+Shift+F');
    const cockpit = page.getByRole('dialog', { name: 'Leader fullscreen cockpit' });
    await expect(cockpit).toBeVisible();
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(n => { document.documentElement.style.fontSize = `${n}px`; }, font);
    const trigger = cockpit.getByRole('button', { name: 'Model selection', exact: true });
    for (let i = 0; i < 30 && !await trigger.evaluate(el => el === document.activeElement); i++) await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    const menu = cockpit.getByRole('dialog', { name: 'Model selection menu' });
    await page.keyboard.press('Tab');
    await expect.poll(() => menu.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(root.locator('[aria-label="Model selection menu"]')).toHaveCount(0);
    await expect(cockpit).toBeVisible();
    await expect(cockpit.getByRole('textbox', { name: 'Leader prompt', exact: true })).toHaveValue(draft);
    await expect(cockpit.getByText('keyboard-context.txt', { exact: true })).toBeVisible();
    const focus = await trigger.evaluate(el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      const ring = Math.max(0, parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset));
      return { visible: el.matches(':focus-visible'), left: r.left - ring, right: r.right + ring, viewport: innerWidth };
    });
    expect(focus.visible).toBe(true); expect(focus.left).toBeGreaterThanOrEqual(0); expect(focus.right).toBeLessThanOrEqual(focus.viewport);
    await page.screenshot({ path: info.outputPath(`owned-keyboard-${theme}-${width}-${font}.png`) });
    await page.keyboard.press('Escape');
    await expect(cockpit).toHaveCount(0);
    await expect(root.getByRole('textbox', { name: 'Leader prompt', exact: true })).toHaveValue(draft);
    expect(fixture.commands.some(c => /^(set_model|set_permission_mode|send_message|continue_work_item|create_session|promote)/.test(c.type))).toBe(false);
  });
}

for (const theme of ['Midnight', 'Daybook']) for (const [width, font] of [[1440, 16], [320, 32]]) {
  for (const outerTarget of ['trigger', 'composer']) test(`sibling Canvas menus cannot own foreground Escape in ${theme} at ${width}px root${font} from ${outerTarget}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const fixture = await openDesignFinishFixture(page, { nodes: [
      { id: 'older', type: 'leader', position: { x: 400, y: 100 }, size: { width: 420, height: 600 },
        data: { ...LEADER_DEFAULT_DATA, sessionKey: null, currentRunKey: null, workItemId: null, status: 'idle', taskName: 'Older Canvas sibling' } },
      { id: 'review', type: 'leader', position: { x: 870, y: 100 }, size: { width: 420, height: 600 },
        data: { ...LEADER_DEFAULT_DATA, sessionKey: 'layout-0', currentRunKey: 'layout-0', workItemId: 'audit-work', status: 'waiting', taskName: title } },
    ] });
    if (theme === 'Daybook') {
      await page.getByRole('button', { name: 'Open settings', exact: true }).click();
      await page.getByRole('button', { name: /^Daybook/ }).click(); await page.keyboard.press('Escape');
    }
    fixture.send({ type: 'harness_list', harnesses: [{ name: 'codex', models: [{ id: 'gpt-6', label: 'Astra', supportsReasoning: true,
      supportedEffortLevels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], defaultEffortLevel: 'high' }],
      builtInTools: [], commands: [], agents: [], account: { provider: 'openai' }, capabilities: {
        mutationInterception: 'observe_only', thinking: true, promptCaching: true, mcp: true, permissionPrompts: true, resume: true,
        partialMessages: false, builtInFilesystem: true, sandboxEnforcement: { filesystem: ['read-only', 'workspace-write', 'unrestricted'], approval: true },
      } }] });
    await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
    const older = page.locator('.leader-node').nth(0), target = page.locator('.leader-node').nth(1);
    const draft = 'Exact sibling-transition guidance\nUnicode: café → Ω\n  Preserve spaces.  ';
    await target.getByRole('textbox', { name: 'Leader prompt', exact: true }).fill(draft);
    await target.getByLabel('Image or text attachments').setInputFiles({ name: 'sibling-context.txt', mimeType: 'text/plain', buffer: Buffer.from('SIMULATED context Ω') });
    await expect(target.getByText('sibling-context.txt', { exact: true })).toBeVisible();
    await older.getByRole('button', { name: 'Model selection', exact: true }).click();
    await expect(older.getByRole('dialog', { name: 'Model selection menu' })).toBeVisible();
    const next = target.getByRole('button', { name: 'Model selection', exact: true });
    for (let i = 0; i < 120 && !await next.evaluate(el => el === document.activeElement); i++) await page.keyboard.press('Tab');
    await expect(next).toBeFocused(); await page.keyboard.press('Control+Shift+F');
    const cockpit = page.getByRole('dialog', { name: 'Leader fullscreen cockpit' });
    await expect(cockpit).toBeVisible(); await page.setViewportSize({ width, height: 900 });
    await page.evaluate(n => { document.documentElement.style.fontSize = `${n}px`; }, font);
    const trigger = cockpit.getByRole('button', { name: 'Model selection', exact: true });
    for (let i = 0; i < 40 && !await trigger.evaluate(el => el === document.activeElement); i++) await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused(); await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
    const menu = cockpit.getByRole('dialog', { name: 'Model selection menu' });
    await expect.poll(() => menu.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); await expect(trigger).toBeFocused();
    const prompt = cockpit.getByRole('textbox', { name: 'Leader prompt', exact: true });
    await expect(prompt).toHaveValue(draft); await expect(cockpit.getByText('sibling-context.txt', { exact: true })).toBeVisible();
    if (outerTarget === 'composer') {
      for (let i = 0; i < 120 && !await prompt.evaluate(el => el === document.activeElement); i++) await page.keyboard.press('Tab');
      await expect(prompt).toBeFocused();
    }
    await page.screenshot({ path: info.outputPath(`sibling-${theme}-${width}-${font}-${outerTarget}.png`) });
    await page.keyboard.press('Escape'); await expect(cockpit).toHaveCount(0);
    await expect(target.getByRole('textbox', { name: 'Leader prompt', exact: true })).toHaveValue(draft);
    await expect(target.getByText('sibling-context.txt', { exact: true })).toBeVisible();
    await expect(older.locator('[aria-label="Model selection menu"]')).toHaveCount(1);
    expect(fixture.commands.some(c => /^(set_model|set_permission_mode|send_message|continue_work_item|create_session|promote)/.test(c.type))).toBe(false);
  });
}

async function tabToOwnedControl(page, target, reverse = false) {
  for (let i = 0; i < 100 && !await target.evaluate(el => el === document.activeElement); i++)
    await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
  await expect(target).toBeFocused();
}
async function retainedOwnershipInputs(cockpit) {
  const draft = 'Owned foreground Escape\nUnicode: café → Ω\n  Preserve trailing spaces.  ';
  await cockpit.getByRole('textbox', { name: 'Leader prompt', exact: true }).fill(draft);
  await cockpit.getByLabel('Image or text attachments').setInputFiles({ name: 'ownership-context.txt',
    mimeType: 'text/plain', buffer: Buffer.from('SIMULATED isolated ownership context Ω') });
  await expect(cockpit.getByText('ownership-context.txt', { exact: true })).toBeVisible();
  return draft;
}
async function reopenedOwnershipInputs(page, cockpit, fixture, draft) {
  await expect(cockpit).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand fullscreen', exact: true }).click();
  await expect(cockpit.getByRole('textbox', { name: 'Leader prompt', exact: true })).toHaveValue(draft);
  await expect(cockpit.getByText('ownership-context.txt', { exact: true })).toBeVisible();
  expect(fixture.commands.filter(c => /^(set_model|set_permission_mode|send_message|continue_work_item|create_session|promote)/.test(c.type))).toEqual([]);
}
for (const theme of ['Midnight', 'Daybook']) for (const [width, font] of [[1440, 16], [320, 32]]) {
  test(`real Leader-actions menu owns first Escape and More focus in ${theme} at ${width}px root${font}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { fixture, cockpit } = await openCockpit(page, theme);
    const draft = await retainedOwnershipInputs(cockpit);
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(n => { document.documentElement.style.fontSize = `${n}px`; }, font);
    const more = cockpit.getByRole('button', { name: 'More leader actions', exact: true });
    await tabToOwnedControl(page, more, true); await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Leader actions', exact: true });
    await expect(menu).toBeVisible();
    await expect.poll(() => menu.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.screenshot({ path: info.outputPath(`real-menu-before-${theme}-${width}-${font}.png`) });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0); await expect(cockpit).toBeVisible(); await expect(more).toBeFocused();
    await expect(cockpit.getByRole('textbox', { name: 'Leader prompt', exact: true })).toHaveValue(draft);
    const ring = await more.evaluate(el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      const outset = Math.max(0, parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset));
      return { visible: el.matches(':focus-visible'), left: r.left - outset, right: r.right + outset, viewport: innerWidth };
    });
    expect(ring.visible).toBe(true); expect(ring.left).toBeGreaterThanOrEqual(0); expect(ring.right).toBeLessThanOrEqual(ring.viewport);
    await page.screenshot({ path: info.outputPath(`real-menu-owned-${theme}-${width}-${font}.png`) });
    await page.keyboard.press('Escape'); await reopenedOwnershipInputs(page, cockpit, fixture, draft);
  });
  for (const catalog of ['fallback', 'normalized']) for (const kind of (catalog === 'fallback' ? ['Model', 'Permission'] : ['Model'])) {
    test(`hidden ${kind} toolbar cannot steal Dashboard Escape in ${theme} at ${width}px root${font} (${catalog})`, async ({ page }, info) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const { fixture, cockpit } = await openCockpit(page, theme);
      const draft = await retainedOwnershipInputs(cockpit);
      if (catalog === 'normalized') fixture.send({ type: 'harness_list', harnesses: [{ name: 'codex',
        models: [{ id: 'gpt-6', label: 'Astra', supportsReasoning: true,
          supportedEffortLevels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], defaultEffortLevel: 'high' }],
        builtInTools: [], commands: [], agents: [], account: { provider: 'openai' }, capabilities: {
          mutationInterception: 'observe_only', thinking: true, promptCaching: true, mcp: true, permissionPrompts: true,
          resume: true, partialMessages: false, builtInFilesystem: true,
          sandboxEnforcement: { filesystem: ['read-only', 'workspace-write', 'unrestricted'], approval: true },
        } }] });
      // Real boundary event, intercepted simulation. No server/provider work or dashboard mutation.
      fixture.send({ type: 'render_update', topic: 'session:layout-0', leaderSessionKey: 'layout-0', action: 'set',
        layout: { title: 'Isolated ownership dashboard', columns: 1 },
        components: [{ id: 'owned-context', type: 'text', content: 'SIMULATED review context — no provider work' }] });
      const dashboard = cockpit.getByRole('button', { name: /^Dashboard/ }); await expect(dashboard).toBeEnabled();
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(n => { document.documentElement.style.fontSize = `${n}px`; }, font);
      const trigger = kind === 'Model' ? cockpit.getByRole('button', { name: 'Model selection', exact: true })
        : cockpit.locator('button[aria-haspopup=dialog]').filter({ hasText: /^Auto/ });
      await tabToOwnedControl(page, trigger); await page.keyboard.press('Enter');
      const menu = cockpit.getByRole('dialog', { name: `${kind} selection menu`, includeHidden: true });
      await expect(menu).toBeVisible();
      await tabToOwnedControl(page, dashboard, true); await page.keyboard.press('Enter');
      await expect(dashboard).toHaveAttribute('aria-current', 'page'); await expect(menu).toBeHidden();
      await expect(dashboard).toBeFocused();
      await page.screenshot({ path: info.outputPath(`hidden-before-${kind}-${theme}-${width}-${font}-${catalog}.png`) });
      await page.keyboard.press('Escape'); await expect(cockpit).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`hidden-exit-${kind}-${theme}-${width}-${font}-${catalog}.png`) });
      await reopenedOwnershipInputs(page, cockpit, fixture, draft);
    });
  }
}

// Source20 independent counterexample promoted to a permanent regression; intercepted IO only.
for(const same of [true,false])for(const theme of ['Midnight','Daybook'])for(const narrow of [false,true])test(`retained ${same?'same-node':'sibling'} real HeaderMenu does not block cockpit Escape ${theme} ${narrow?'320-root32':'1440-root16'}`,async({page},info)=>{
 await page.setViewportSize({width:1440,height:900});
 const fixture=await openDesignFinishFixture(page,{nodes:[{id:'older',type:'leader',position:{x:400,y:100},size:{width:420,height:600},data:{...LEADER_DEFAULT_DATA,status:'idle',taskName:'Older Canvas sibling'}},{id:'review',type:'leader',position:{x:870,y:100},size:{width:420,height:600},data:{...LEADER_DEFAULT_DATA,sessionKey:'layout-0',currentRunKey:'layout-0',workItemId:'audit-work',status:'waiting'}}]});
 if(theme==='Daybook'){await page.getByRole('button',{name:'Open settings',exact:true}).click();await page.getByRole('button',{name:/^Daybook/}).click();await page.keyboard.press('Escape');}
 await page.getByRole('tab',{name:'Canvas',exact:true}).click();
 const target=page.locator('.leader-node').nth(1),owner=page.locator('.leader-node').nth(same?1:0);
 const draft='Independent Header sibling\n café → Ω\n  exact spaces  ';
 await target.getByRole('textbox',{name:'Leader prompt',exact:true}).fill(draft);
 await target.getByLabel('Image or text attachments').setInputFiles({name:'header-context.txt',mimeType:'text/plain',buffer:Buffer.from('SIMULATED private input Ω')});
 await expect(target.getByText('header-context.txt',{exact:true})).toBeVisible();
 await owner.getByRole('button',{name:'More leader actions',exact:true}).click();
 const bodymenu=page.getByRole('menu',{name:'Leader actions',exact:true});await expect(bodymenu).toBeVisible();
 await tabToOwnedControl(page,target.getByRole('button',{name:'Model selection',exact:true}));
 await page.keyboard.press('Control+Shift+F');const cockpit=page.getByRole('dialog',{name:'Leader fullscreen cockpit'});await expect(cockpit).toBeVisible();
 if(narrow){await page.setViewportSize({width:320,height:900});await page.evaluate(()=>document.documentElement.style.fontSize='32px');}
 const trigger=cockpit.getByRole('button',{name:'Model selection',exact:true});await tabToOwnedControl(page,trigger);await page.keyboard.press('Enter');await page.keyboard.press('Tab');
 const menu=cockpit.getByRole('dialog',{name:'Model selection menu'});await expect.poll(()=>menu.evaluate(el=>el.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(trigger).toBeFocused();await expect(cockpit).toBeVisible();
 await page.screenshot({path:info.outputPath('header-before-outer.png')});
 await page.keyboard.press('Escape');
 const witness=await page.evaluate(()=>({cockpits:document.querySelectorAll('.leader-fullscreen-overlay').length,menus:[...document.querySelectorAll('[role=menu]')].map(el=>({label:el.getAttribute('aria-label'),parent:el.parentElement?.tagName,visible:!!el.getClientRects().length,hidden:!!el.closest('[inert],[hidden]')})),active:document.activeElement?.outerHTML}));
 await page.screenshot({path:info.outputPath('header-after-outer.png')});
 expect(fixture.commands.filter(c=>/^(set_model|set_permission_mode|send_message|continue_work_item|create_session|promote)/.test(c.type))).toEqual([]);
 await expect(cockpit).toHaveCount(0);
 await expect(target.getByRole('textbox',{name:'Leader prompt',exact:true})).toHaveValue(draft);
});

// Source20 independent counterexample promoted to a permanent regression; intercepted IO only.
for(const theme of ['Midnight','Daybook'])for(const [width,font] of [[1440,16],[320,16],[320,32]])test(`focused Dashboard paint ${theme} ${width} root${font}`,async({page},info)=>{
 await page.setViewportSize({width:1440,height:900});const fixture=await openDesignFinishFixture(page,{nodes:[{id:'review',type:'leader',position:{x:500,y:100},size:{width:560,height:600},data:{...LEADER_DEFAULT_DATA,sessionKey:'layout-0',currentRunKey:'layout-0',workItemId:'audit-work',status:'waiting',taskName:'Improve responsive layouts across laptop screens'}}]});
 if(theme==='Daybook'){await page.getByRole('button',{name:'Open settings',exact:true}).click();await page.getByRole('button',{name:/^Daybook/}).click();await page.keyboard.press('Escape');}
 await page.getByRole('button',{name:/Improve responsive layouts across laptop screens/}).first().press('Enter');await page.getByRole('button',{name:'Expand fullscreen',exact:true}).click();const cockpit=page.getByRole('dialog',{name:'Leader fullscreen cockpit'});
 fixture.send({type:'render_update',topic:'session:layout-0',leaderSessionKey:'layout-0',action:'set',layout:{title:'Independent Dashboard focus paint',columns:1},components:[{id:'review-context',type:'text',content:'SIMULATED no provider work'}]});
 await page.setViewportSize({width,height:900});await page.evaluate(n=>document.documentElement.style.fontSize=n+'px',font);
 const model=cockpit.getByRole('button',{name:'Model selection',exact:true}),dashboard=cockpit.getByRole('button',{name:/^Dashboard/});await tabToOwnedControl(page,model,true);await page.keyboard.press('Enter');await expect(cockpit.getByRole('dialog',{name:'Model selection menu'})).toBeVisible();await tabToOwnedControl(page,dashboard,true);
 const measure=()=>dashboard.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el),nav=el.closest('nav'),n=nav.getBoundingClientRect();const text=[...el.childNodes].find(n=>n.nodeType===3),range=document.createRange();range.selectNodeContents(text);const t=range.getBoundingClientRect();return {label:el.textContent,focusVisible:el.matches(':focus-visible'),outline:s.outline,offset:s.outlineOffset,rect:r.toJSON(),textRect:t.toJSON(),navRect:n.toJSON(),navScrollLeft:nav.scrollLeft,navScrollWidth:nav.scrollWidth,navClientWidth:nav.clientWidth,leftClip:Math.max(0,n.left-r.left),rightClip:Math.max(0,r.right-n.right),textLeftClip:Math.max(0,n.left-t.left),textRightClip:Math.max(0,t.right-n.right),rootFont:getComputedStyle(document.documentElement).fontSize};});
 const before=await measure();await page.screenshot({path:info.outputPath('dashboard-focused-before-enter.png'),animations:'disabled'});await page.keyboard.press('Enter');await expect(dashboard).toHaveAttribute('aria-current','page');const after=await measure();await page.screenshot({path:info.outputPath('dashboard-focused-after-enter.png'),animations:'disabled'});
 // Navigation is separately sound: do not confuse painted failure with repaired hidden ownership.
 await page.keyboard.press('Escape');await expect(cockpit).toHaveCount(0);
 for (const state of [before,after]) { expect(state.focusVisible).toBe(true); expect(state.textLeftClip).toBeLessThanOrEqual(1); expect(state.leftClip).toBeLessThanOrEqual(1); expect(state.rightClip).toBeLessThanOrEqual(1); }
 expect(after.textLeftClip,'focused primary Dashboard visible label must not be clipped').toBeLessThanOrEqual(1);expect(after.leftClip,'complete focus ring must be visible within scroll rail').toBeLessThanOrEqual(1);expect(after.rightClip).toBeLessThanOrEqual(1);
});
// Source20 independent counterexample promoted to a permanent regression; intercepted IO only.
for(const theme of ['Midnight','Daybook'])for(const width of [1440,320])test(`real portal menu type ${theme} ${width}`,async({page},info)=>{
 await page.setViewportSize({width:1440,height:900});const fixture=await openDesignFinishFixture(page,{nodes:[{id:'review',type:'leader',position:{x:500,y:100},size:{width:560,height:600},data:{...LEADER_DEFAULT_DATA,sessionKey:'layout-0',currentRunKey:'layout-0',status:'waiting',taskName:'Improve responsive layouts across laptop screens'}}]});if(theme==='Daybook'){await page.getByRole('button',{name:'Open settings',exact:true}).click();await page.getByRole('button',{name:/^Daybook/}).click();await page.keyboard.press('Escape');}
 await page.getByRole('button',{name:/Improve responsive layouts across laptop screens/}).first().press('Enter');await page.getByRole('button',{name:'Expand fullscreen',exact:true}).click();const cockpit=page.getByRole('dialog',{name:'Leader fullscreen cockpit'});const more=cockpit.getByRole('button',{name:'More leader actions',exact:true});const states=[];
 for(const font of [16,32]){await page.setViewportSize({width,height:900});await page.evaluate(n=>document.documentElement.style.fontSize=n+'px',font);await tabToOwnedControl(page,more);await page.keyboard.press('Enter');const menu=page.getByRole('menu',{name:'Leader actions',exact:true});await expect(menu).toBeVisible();await expect(menu.getByRole('menuitem',{name:'Save as preset',exact:true})).toBeFocused();await page.keyboard.press('Enter');const input=menu.getByPlaceholder('My leader preset');await expect(input).toBeFocused();await input.fill('Unsent preset café Ω');await menu.getByPlaceholder('What this setup is for').fill('Only simulated review of preset paint');const result=await menu.evaluate(el=>({bodyPortal:el.parentElement===document.body,rootFont:getComputedStyle(document.documentElement).fontSize,menuItem:getComputedStyle(el.querySelector('[role=menuitem]')).fontSize,label:getComputedStyle(el.querySelector('.leader-header-menu__label')).fontSize,formLabel:getComputedStyle(el.querySelector('.leader-header-menu__form label > span')).fontSize,input:getComputedStyle(el.querySelector('input')).fontSize,save:getComputedStyle(el.querySelector('.leader-header-menu__save')).fontSize,rect:el.getBoundingClientRect().toJSON()}));states.push({font,...result});await page.screenshot({path:info.outputPath(`preset-root${font}.png`),animations:'disabled'});await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(cockpit).toBeVisible();await expect(more).toBeFocused();}
 expect(fixture.commands.filter(c=>/^(set_model|set_permission_mode|send_message|create_session|save_leader_preset|promote)/.test(c.type))).toEqual([]);for (const role of ['menuItem','label','formLabel','input','save']) { expect(parseFloat(states[0][role])).toBeGreaterThanOrEqual(12); expect(parseFloat(states[1][role]),`approved ${role} follows 200% root resizing`).toBeGreaterThanOrEqual(parseFloat(states[0][role])*1.99); }
 for (const state of states) { expect(state.bodyPortal).toBe(true); expect(state.rect.left).toBeGreaterThanOrEqual(9); expect(state.rect.right).toBeLessThanOrEqual(width-9); }
});

for (const theme of ['Midnight', 'Daybook']) test(`real portal follows live viewport and text resizing in ${theme}`, async ({page}, info) => {
  await page.setViewportSize({width:1440,height:900});
  const {fixture,cockpit}=await openCockpit(page,theme);
  const more=cockpit.getByRole('button',{name:'More leader actions',exact:true});
  await tabToOwnedControl(page,more); await page.keyboard.press('Enter');
  const menu=page.getByRole('menu',{name:'Leader actions',exact:true});
  await expect(menu.getByRole('menuitem',{name:'Save as preset',exact:true})).toBeFocused();
  await page.keyboard.press('Enter'); const name=menu.getByPlaceholder('My leader preset');
  await expect(name).toBeFocused(); await name.fill('Unsent café Ω');
  for (const [width,font] of [[320,32],[1440,32],[320,16]]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(n=>document.documentElement.style.fontSize=n+'px',font);
    await expect.poll(()=>menu.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=9&&r.right<=innerWidth-9;})).toBe(true);
    await expect(name).toHaveValue('Unsent café Ω');
    await page.screenshot({path:info.outputPath(`portal-live-${theme}-${width}-${font}.png`)});
  }
  await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); await expect(more).toBeFocused();
  expect(fixture.commands.filter(c=>/^(save_leader_preset|set_model|set_permission_mode|create_session|continue_work_item|send_message)/.test(c.type))).toEqual([]);
});

// Source21 independent findings: selection outside the rail and steady reduced-motion readiness.
function workspacePaint(tab) {
  return tab.evaluate(el => {
    const control = el.getBoundingClientRect(), rail = el.parentElement.getBoundingClientRect();
    const text = document.createRange();
    text.selectNodeContents([...el.childNodes].find(node => node.nodeType === Node.TEXT_NODE));
    const label = text.getBoundingClientRect();
    return { clip: Math.max(0, rail.left-control.left, control.right-rail.right,
      rail.left-label.left, label.right-rail.right), focus: el === document.activeElement,
      focusVisible: el.matches(':focus-visible'), scrollY: window.scrollY };
  });
}
for (const theme of ['Midnight', 'Daybook']) for (const motion of ['reduce', 'no-preference']) {
  test(`attention selection locally reveals Dashboard ${theme} ${motion}`, async ({page}, info) => {
    await page.emulateMedia({reducedMotion:motion}); await page.setViewportSize({width:1440,height:900});
    const {fixture,cockpit}=await openCockpit(page,theme);
    fixture.send({type:'render_update',topic:'session:layout-0',leaderSessionKey:'layout-0',action:'set',
      layout:{title:'Simulated decision'},components:[{id:'decision',type:'form',fields:[
        {id:'choice',label:'Choice',kind:'select',options:['One','Two']}]}]});
    await page.setViewportSize({width:320,height:900});
    await page.evaluate(()=>document.documentElement.style.fontSize='32px');
    const attention=cockpit.getByRole('button',{name:/question needs your response/});
    await tabToOwnedControl(page,attention); await page.keyboard.press('Enter');
    const dashboard=cockpit.getByRole('button',{name:/^Dashboard/});
    await expect(dashboard).toHaveAttribute('aria-current','page');
    // The attention button unmounts; revealing selection must not move focus onto the rail.
    await expect(dashboard).not.toBeFocused();
    for (const [width,font] of [[320,32],[1440,32],[800,16],[320,16]]) {
      await page.setViewportSize({width,height:900});
      await page.evaluate(n=>document.documentElement.style.fontSize=n+'px',font);
      await expect.poll(async()=>(await workspacePaint(dashboard)).clip).toBeLessThanOrEqual(1);
      expect((await workspacePaint(dashboard)).scrollY).toBe(0);
      await expect(dashboard).not.toBeFocused();
      await page.screenshot({path:info.outputPath(`attention-${width}-${font}.png`),animations:'disabled'});
    }
    expect(fixture.commands.filter(c=>/^(set_model|set_permission_mode|send_message|continue_work_item|create_session|promote|submit_form)/.test(c.type))).toEqual([]);
  });

  test(`visible owned HeaderMenu is immediately keyboard operable ${theme} ${motion}`, async ({page}, info) => {
    await page.emulateMedia({reducedMotion:motion}); await page.setViewportSize({width:1440,height:900});
    const {fixture,cockpit}=await openCockpit(page,theme);
    const more=cockpit.getByRole('button',{name:'More leader actions',exact:true});
    for (const [width,font] of [[1440,16],[320,32],[800,16]]) {
      await page.setViewportSize({width,height:900});
      await page.evaluate(n=>document.documentElement.style.fontSize=n+'px',font);
      await tabToOwnedControl(page,more); await page.keyboard.press('Enter');
      const menu=page.getByRole('menu',{name:'Leader actions',exact:true});
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem',{name:'Save as preset',exact:true})).toBeFocused();
      await page.keyboard.press('Enter'); const name=menu.getByPlaceholder('My leader preset');
      await expect(name).toBeFocused(); await name.fill('Unsent café Ω  ');
      await page.setViewportSize({width:width===320?1440:320,height:900});
      await expect(name).toBeFocused(); await expect(name).toHaveValue('Unsent café Ω  ');
      await page.screenshot({path:info.outputPath(`menu-ready-${width}-${font}.png`),animations:'disabled'});
      await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);
      await expect(more).toBeFocused(); await expect(cockpit).toBeVisible();
    }
    expect(fixture.commands.filter(c=>/^(save_leader_preset|set_model|set_permission_mode|send_message|continue_work_item|create_session|promote)/.test(c.type))).toEqual([]);
  });
}
for (const theme of ['Midnight','Daybook']) test(`steady reduced-motion selected Dashboard retains whole focus paint ${theme}`,async({page},info)=>{
  await page.emulateMedia({reducedMotion:'reduce'}); await page.setViewportSize({width:1440,height:900});
  const {fixture,cockpit}=await openCockpit(page,theme);
  fixture.send({type:'render_update',topic:'session:layout-0',leaderSessionKey:'layout-0',action:'set',
    layout:{},components:[{id:'context',type:'text',content:'Simulated Dashboard'}]});
  const prompt=cockpit.getByRole('textbox',{name:'Leader prompt',exact:true}),draft='Exact steady input\nΩ café  ';
  await prompt.fill(draft); await page.setViewportSize({width:320,height:900});
  await page.evaluate(()=>document.documentElement.style.fontSize='32px');
  const model=cockpit.getByRole('button',{name:'Model selection',exact:true}),dashboard=cockpit.getByRole('button',{name:/^Dashboard/});
  await tabToOwnedControl(page,model); await page.keyboard.press('Enter');
  await expect(cockpit.getByRole('dialog',{name:'Model selection menu'})).toBeVisible();
  await tabToOwnedControl(page,dashboard,true); await page.keyboard.press('Enter');
  await expect(dashboard).toHaveAttribute('aria-current','page');
  for (const [width,font] of [[320,32],[1440,32],[800,16],[320,16],[320,32]]) {
    await page.setViewportSize({width,height:900}); await page.evaluate(n=>document.documentElement.style.fontSize=n+'px',font);
    await expect.poll(async()=>(await workspacePaint(dashboard)).clip).toBeLessThanOrEqual(1);
    await expect(dashboard).toBeFocused(); expect((await workspacePaint(dashboard)).focusVisible).toBe(true);
    await page.screenshot({path:info.outputPath(`steady-focused-${width}-${font}.png`),animations:'disabled'});
  }
  await page.keyboard.press('Escape'); await expect(cockpit).toHaveCount(0);
  await page.getByRole('button',{name:'Expand fullscreen',exact:true}).click(); await expect(prompt).toHaveValue(draft);
  expect(fixture.commands.filter(c=>/^(set_model|set_permission_mode|send_message|continue_work_item|create_session|promote)/.test(c.type))).toEqual([]);
});
