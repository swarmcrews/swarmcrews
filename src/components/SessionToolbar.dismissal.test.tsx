import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SessionToolbar } from './SessionToolbar.tsx';
import { HarnessListProvider } from '../use-harness-list.tsx';
import type { ServerMessage } from '../use-socket.ts';

function setup() {
  let receive: ((message: ServerMessage) => void) | undefined;
  const model = vi.fn(), permission = vi.fn();
  render(<HarnessListProvider connected send={() => {}} subscribe={callback => {
    receive = callback; return () => {};
  }}><SessionToolbar status="waiting" sessionKey="run-1" model="sonnet" permissionMode="auto"
    harness="claude" onModelChange={model} onPermissionModeChange={permission} /></HarnessListProvider>);
  act(() => receive?.({ type: 'harness_list', harnesses: [{ name: 'claude', models: [{ id: 'sonnet', label: 'Sonnet' }],
    builtInTools: [], commands: [], agents: [], account: { provider: 'anthropic' }, capabilities: {
      mutationInterception: 'complete', thinking: true, promptCaching: true, mcp: true,
      permissionPrompts: true, resume: true, partialMessages: true, builtInFilesystem: true,
    } }] }));
  return { model, permission };
}
function toolbarPair(inactive = false, foregroundDialog = false) {
  const props = { status: 'waiting', sessionKey: 'run-1', model: 'sonnet',
    permissionMode: 'auto' as const, onModelChange: vi.fn(), onPermissionModeChange: vi.fn() };
  return <HarnessListProvider connected={false} send={() => {}} subscribe={() => () => {}}>
    <div data-testid="background" inert={inactive}><SessionToolbar {...props} active={!inactive} /></div>
    <div data-testid="foreground" role={foregroundDialog ? 'dialog' : undefined}><SessionToolbar {...props} /><input aria-label="Foreground input" /></div>
  </HarnessListProvider>;
}
const outerEscape = vi.fn();
afterEach(() => { window.removeEventListener('keydown', outerEscape); outerEscape.mockClear(); });

describe('SessionToolbar owned dismissal', () => {
  it.each(['Model selection', 'Auto▼'])('Escape consumes only the open %s dropdown and restores its trigger', name => {
    const callbacks = setup();
    window.addEventListener('keydown', outerEscape);
    const trigger = screen.getByRole('button', { name });
    fireEvent.click(trigger);
    const menu = screen.getByRole('dialog');
    const option = within(menu).getAllByRole('button')[0]!;
    option.focus();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { option.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(outerEscape).not.toHaveBeenCalled();
    expect(callbacks.model).not.toHaveBeenCalled();
    expect(callbacks.permission).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(outerEscape).toHaveBeenCalledTimes(1);
  });

  it.each(['Model selection', 'Auto▼'])('an inactive background drops its %s menu without consuming foreground Escape', name => {
    const view = render(toolbarPair());
    const background = screen.getByTestId('background');
    fireEvent.click(within(background).getByRole('button', { name }));
    expect(within(background).getByRole('dialog')).toBeInTheDocument();
    view.rerender(toolbarPair(true));
    expect(within(background).queryByRole('dialog', { hidden: true })).not.toBeInTheDocument();
    const foreground = screen.getByTestId('foreground');
    const trigger = within(foreground).getByRole('button', { name });
    fireEvent.click(trigger);
    const option = within(within(foreground).getByRole('dialog')).getAllByRole('button')[0]!;
    option.focus(); fireEvent.keyDown(option, { key: 'Escape' });
    expect(within(foreground).queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    view.rerender(toolbarPair());
    expect(within(background).queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not let an earlier toolbar consume Escape from a different toolbar', () => {
    render(toolbarPair());
    const background = screen.getByTestId('background'), foreground = screen.getByTestId('foreground');
    fireEvent.click(within(background).getByRole('button', { name: 'Model selection' }));
    fireEvent.click(within(foreground).getByRole('button', { name: 'Model selection' }));
    const trigger = within(foreground).getByRole('button', { name: 'Model selection' });
    const option = within(within(foreground).getByRole('dialog')).getAllByRole('button')[0]!;
    option.focus(); fireEvent.keyDown(option, { key: 'Escape' });
    expect(within(foreground).queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(within(background).getByRole('dialog')).toBeInTheDocument();
  });

  it('a background toolbar does not consume Escape from non-toolbar foreground dialog content', () => {
    render(toolbarPair(false, true));
    const background = screen.getByTestId('background');
    fireEvent.click(within(background).getByRole('button', { name: 'Model selection' }));
    window.addEventListener('keydown', outerEscape);
    const input = screen.getByRole('textbox', { name: 'Foreground input' });
    input.focus(); fireEvent.keyDown(input, { key: 'Escape' });
    expect(outerEscape).toHaveBeenCalledTimes(1);
    expect(input).toHaveFocus();
    expect(within(background).getByRole('dialog')).toBeInTheDocument();
  });

  it.each(['Model selection', 'Auto▼'])('hidden %s cannot consume Escape from its same-dialog foreground Dashboard', name => {
    const props = { status: 'waiting', sessionKey: 'run-1', model: 'sonnet', permissionMode: 'auto' as const,
      onModelChange: vi.fn(), onPermissionModeChange: vi.fn() };
    const ui = (hidden = false) => <HarnessListProvider connected={false} send={() => {}} subscribe={() => () => {}}>
      <div role="dialog" aria-label="Cockpit"><section hidden={hidden}><SessionToolbar {...props} /></section>
        <button>Dashboard</button></div></HarnessListProvider>;
    const view = render(ui());
    fireEvent.click(screen.getByRole('button', { name }));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    view.rerender(ui(true));
    const dashboard = screen.getByRole('button', { name: 'Dashboard' }); dashboard.focus();
    window.addEventListener('keydown', outerEscape);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { dashboard.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(outerEscape).toHaveBeenCalledTimes(1);
    expect(dashboard).toHaveFocus();
    expect(props.onModelChange).not.toHaveBeenCalled(); expect(props.onPermissionModeChange).not.toHaveBeenCalled();
    view.rerender(ui());
    // Keeping the mounted toolbar does not remount/reset configuration or its transient state.
    const menu = screen.getAllByRole('dialog').find(el => el.getAttribute('aria-label') !== 'Cockpit')!;
    expect(menu).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name });
    const option = within(menu).getAllByRole('button')[0]!;
    option.focus(); fireEvent.keyDown(option, { key: 'Escape' });
    expect(trigger).toHaveFocus(); expect(outerEscape).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('outside-pointer dismissal does not consume pointer focus or mutate configuration', () => {
    const callbacks = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Model selection' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(callbacks.model).not.toHaveBeenCalled();
    expect(callbacks.permission).not.toHaveBeenCalled();
  });
});
