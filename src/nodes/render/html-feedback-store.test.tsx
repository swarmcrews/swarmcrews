// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { HtmlFeedbackStore, getHtmlFeedbackStore } from './html-feedback-store.ts';
import type { FeedbackState } from './html-feedback.ts';
const state: FeedbackState = { captures: [{ id: 'revision', html: '<p>A</p>', capturedAt: 'now', width: 800, height: 600 }], items: [{ id: 'F01', captureId: 'revision', request: 'Change A', scope: 'instance', acceptance: '', status: 'ready', target: { kind: 'region', scroll: { x: 0, y: 0 }, bounds: { x: 0, y: 0, width: .1, height: .1 } } }] };
function setup() {
  const sessionKey = crypto.randomUUID();
  const store = getHtmlFeedbackStore(sessionKey, 'review');
  const listeners = new Set<(m: unknown) => void>();
  const send = vi.fn();
  store.connect({ sessionKey, socketSend: send, socketSubscribe: (fn: (m: unknown) => void) => { listeners.add(fn); return () => listeners.delete(fn); } });
  store.update(() => state);
  return { sessionKey, store, listeners, send };
}
describe('shared feedback journal', () => {
  it('shares mutations across simultaneously mounted surfaces', () => {
    const { store, sessionKey } = setup();
    const second = getHtmlFeedbackStore(sessionKey, 'review');
    const subscriber = vi.fn(); const unsubscribe = second.subscribe(subscriber);
    store.update(s => ({ ...s, items: [...s.items, { ...s.items[0]!, id: 'F02', request: 'Another note' }] }));
    expect(second.snapshot().state.items.map(i => i.id)).toEqual(['F01', 'F02']);
    expect(subscriber).toHaveBeenCalled(); unsubscribe();
  });
  it('keeps matching late receipts after UI subscribers unmount', () => {
    const { store, send, listeners, sessionKey } = setup();
    const unsubscribe = store.subscribe(() => {});
    store.send('<p>A</p>'); unsubscribe();
    const outgoing = send.mock.calls[0]![0];
    expect(JSON.parse(window.localStorage.getItem(store.key)!).outgoing[0].id).toBe(outgoing.requestId);
    listeners.forEach(fn => fn({ type: 'control_response', command: 'send_message', sessionKey, requestId: outgoing.requestId, success: true }));
    expect(getHtmlFeedbackStore(sessionKey, 'review').snapshot().state.items[0]?.status).toBe('sent');
    expect(store.snapshot().pending).toBe(false);
  });
  it('does not cross the socket boundary if the outgoing marker cannot be persisted', () => {
    const { store, send } = setup();
    const write = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    store.send('<p>A</p>');
    expect(send).not.toHaveBeenCalled();
    expect(store.snapshot().pending).toBe(false);
    expect(store.snapshot().storageError).toContain('storage');
    write.mockRestore();
  });
  it('restores an outgoing marker as unconfirmed after a page reload', () => {
    const { store, sessionKey, send } = setup();
    store.send('<p>A</p>');
    const restored = new HtmlFeedbackStore(sessionKey, 'review');
    expect(restored.snapshot().pending).toBe(true);
    expect(restored.snapshot().delivery).toContain('not confirmed');
    restored.connect({ sessionKey, socketSend: send, socketSubscribe: () => () => {} });
    restored.send('<p>A</p>');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('keeps empty regions as selectable drafts but never submits them as instructions', () => {
    const { store, send } = setup();
    store.update(s => ({ ...s, items: s.items.map(i => ({ ...i, request: '' })) }));
    store.send('<p>A</p>');
    expect(store.snapshot().state.items).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
    store.update(s => ({ ...s, items: [...s.items, { ...s.items[0]!, id: 'F02', request: 'Reduce spacing' }] }));
    store.send('<p>A</p>');
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0].displayPrompt).toContain('F02');
    expect(send.mock.calls[0]![0].displayPrompt).not.toContain('F01');
  });
  it('does not send stale capture evidence after HTML changes', () => {
    const { store, send } = setup();
    store.send('<p>B</p>');
    expect(send).not.toHaveBeenCalled();
    expect(store.snapshot().delivery).toContain('current revision');
  });
  it('keeps deleted notes out of storage, stale-tab merges and submitted batches', () => {
    const { store, send } = setup();
    const stale = window.localStorage.getItem(store.key)!;
    store.update(s => ({ ...s, items: [] }));
    window.dispatchEvent(new StorageEvent('storage', { key: store.key, newValue: stale }));
    expect(store.snapshot().state.items).toEqual([]);
    // A later stale functional updater must not resurrect a deleted id either.
    store.update(() => state);
    expect(store.snapshot().state.items).toEqual([]);
    store.send('<p>A</p>');
    expect(send).not.toHaveBeenCalled();
    expect(new HtmlFeedbackStore(store.sessionKey, 'review').snapshot().state.items).toEqual([]);
  });
  it('locks draft mutation while a batch is awaiting receipt', () => {
    const { store } = setup();
    store.send('<p>A</p>');
    store.update(s => ({ ...s, items: [] }));
    expect(store.snapshot().state.items).toHaveLength(1);
  });
  it('does not mark an edited note submitted when an older receipt arrives after an explicit retry reset', () => {
    const { store, send, listeners, sessionKey } = setup();
    store.send('<p>A</p>');
    const outgoing = send.mock.calls[0]![0];
    store.resetDelivery();
    store.update(s => ({ ...s, items: s.items.map(i => ({ ...i, request: 'Revised request' })) }));
    listeners.forEach(fn => fn({ type: 'control_response', command: 'send_message', sessionKey, requestId: outgoing.requestId, success: true }));
    expect(store.snapshot().state.items[0]).toMatchObject({ request: 'Revised request', status: 'ready' });
    expect(store.snapshot().delivery).toContain('remain drafts');
  });
  it('merges distinct cross-tab notes rather than replacing local drafts', () => {
    const { store } = setup();
    const incoming = { ...state, items: [{ ...state.items[0], id: 'F02', request: 'From another tab' }], outgoing: [] };
    window.dispatchEvent(new StorageEvent('storage', { key: store.key, newValue: JSON.stringify(incoming) }));
    expect(store.snapshot().state.items.map(i => i.id)).toEqual(['F01', 'F02']);
  });
});
