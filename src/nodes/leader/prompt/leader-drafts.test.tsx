import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { carryLeaderLaunchDraft, forgetLeaderDrafts, leaderDraftScope, useLeaderDraftField, useLeaderDraftLifetimes } from './leader-drafts.ts';
import { LEADER_DEFAULT_DATA } from '../types.ts';
import type { CanvasNode } from '../../../types.ts';

const scope = (nodeId = 'one', workItemId = 'work-1', currentRunKey = 'run-1', project = 'project-1') =>
  leaderDraftScope(project, nodeId, { workItemId, currentRunKey, sessionKey: currentRunKey });
const field = (key = scope()) => renderHook(() => useLeaderDraftField(key, 'text', ''));

describe('identity-scoped browser-memory Leader drafts', () => {
  it('retains exact text across owner unmount and synchronizes mounted composers', () => {
    const a = field();
    act(() => a.result.current[1]('Exact unsent text\nwith a second line.'));
    const b = field();
    expect(b.result.current[0]).toBe('Exact unsent text\nwith a second line.');
    act(() => b.result.current[1](text => `${text} New guidance.`));
    expect(a.result.current[0]).toContain('New guidance.');
    a.unmount(); b.unmount();
    expect(field().result.current[0]).toContain('New guidance.');
  });

  it.each([scope('two'), scope('one', 'work-2'), scope('one', 'work-1', 'run-2'), scope('one', 'work-1', 'run-1', 'project-2')])(
    'never inherits another node, WorkItem, run or project (%s)', key => {
      const a = field();
      act(() => a.result.current[1]('Private target draft'));
      expect(field(key).result.current[0]).toBe('');
    });

  it('an authoritative null run never falls back to stale legacy stream identity', () => {
    expect(leaderDraftScope('project-1', 'one', { workItemId: 'work-1', currentRunKey: null, sessionKey: 'old' }))
      .toBe(leaderDraftScope('project-1', 'one', { workItemId: 'work-1', currentRunKey: null, sessionKey: 'other' }));
    expect(leaderDraftScope('project-1', 'one', { workItemId: 'work-1', currentRunKey: null, sessionKey: 'old' }))
      .not.toBe(scope('one', 'work-1', 'old'));
  });

  it('successful send/explicit clear survives reopening; functional failure recovery retains text', () => {
    const a = field();
    act(() => a.result.current[1]('Retry me'));
    act(() => a.result.current[1](''));
    act(() => a.result.current[1](text => text || 'Retry me'));
    expect(a.result.current[0]).toBe('Retry me');
    act(() => a.result.current[1](''));
    a.unmount();
    expect(field().result.current[0]).toBe('');
  });

  it('removed identities cannot be resurrected by stale asynchronous callbacks', () => {
    const a = field();
    const oldSetter = a.result.current[1];
    act(() => oldSetter('Will be removed'));
    a.unmount();
    act(() => forgetLeaderDrafts());
    const next = field();
    act(() => oldSetter('Late launch failure or attachment result'));
    expect(next.result.current[0]).toBe('');
  });

  it('retains independently keyed attachment fields and invalidates all fields on removal', () => {
    const empty: string[] = [];
    const a = renderHook(() => useLeaderDraftField(scope(), 'attachments', empty));
    act(() => a.result.current[1](['retained-attachment']));
    a.unmount();
    const b = renderHook(() => useLeaderDraftField(scope(), 'attachments', empty));
    expect(b.result.current[0]).toEqual(['retained-attachment']);
    const stale = b.result.current[1];
    b.unmount();
    forgetLeaderDrafts();
    const c = renderHook(() => useLeaderDraftField(scope(), 'attachments', empty));
    act(() => stale(['late-decoding-result']));
    expect(c.result.current[0]).toEqual([]);
  });

  it('prunes unmounted removed/changed-run drafts using authoritative node identity, not presentation', () => {
    const a = field();
    act(() => a.result.current[1]('Old run text')); a.unmount();
    const node: CanvasNode = { id: 'one', type: 'leader', position: { x: 0, y: 0 },
      size: { width: 500, height: 500 }, data: { ...LEADER_DEFAULT_DATA, workItemId: 'work-1', currentRunKey: 'run-2' } };
    const lifetime = renderHook(({ nodes }) => useLeaderDraftLifetimes('project-1', nodes, true), { initialProps: { nodes: [node] } });
    expect(field().result.current[0]).toBe('');
    const fresh = field(scope('one', 'work-1', 'run-2'));
    act(() => fresh.result.current[1]('New run')); fresh.unmount();
    lifetime.rerender({ nodes: [] });
    expect(field(scope('one', 'work-1', 'run-2')).result.current[0]).toBe('');
  });

  it('does not erase an active prelaunch composer when unrelated Canvas nodes update', () => {
    const a = field(scope('prelaunch', '', ''));
    act(() => a.result.current[1]('Compose before creating a node'));
    renderHook(() => useLeaderDraftLifetimes('project-1', [], true));
    expect(a.result.current[0]).toBe('Compose before creating a node');
  });
  it('carries drafts only during explicit Start allocation and preserves late recovery/removal semantics', () => {
    const from = leaderDraftScope('project-1', 'one', {}), to = scope();
    const a = field(from);
    const recovery = a.result.current[1];
    act(() => recovery('Launch draft'));
    carryLeaderLaunchDraft(from, to);
    const b = field(to);
    expect(b.result.current[0]).toBe('Launch draft');
    act(() => recovery(text => `${text} recovered`));
    expect(b.result.current[0]).toBe('Launch draft recovered');
    a.unmount(); b.unmount();
    forgetLeaderDrafts();
    const c = field(to);
    act(() => recovery('Late result after removal'));
    expect(c.result.current[0]).toBe('');
  });

  it('an explicit allocation never overwrites an already owned destination draft', () => {
    const a = field(scope('one', 'work-1', 'run-1')), b = field(scope('two'));
    act(() => { a.result.current[1]('Source'); b.result.current[1]('Destination'); });
    carryLeaderLaunchDraft(scope(), scope('two'));
    expect(b.result.current[0]).toBe('Destination');
  });

});
