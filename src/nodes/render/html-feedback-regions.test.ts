import { describe, expect, it } from 'vitest';
import type { FeedbackState } from './html-feedback.ts';
import { hitFeedbackRegion } from './html-feedback-regions.ts';

const state: FeedbackState = {
  captures: [{ id: 'capture', html: 'revision', width: 800, height: 600, capturedAt: 'now' }],
  items: [{ id: 'F01', captureId: 'capture', request: '', acceptance: '', scope: 'instance', status: 'ready', target: {
    kind: 'region', bounds: { x: .1, y: .2, width: .25, height: .1 }, scroll: { x: 20, y: 100 },
  } }],
};
describe('saved region selection', () => {
  it('hits visible region geometry using capture and current scroll offsets', () => {
    // Document bounds (100,220)-(300,280), viewport bounds (70,170)-(270,230).
    const scroll = { x: 30, y: 50 };
    expect(hitFeedbackRegion(state, 'revision', 800, 600, { x: 80, y: 180 }, scroll)?.id).toBe('F01');
    expect(hitFeedbackRegion(state, 'revision', 800, 600, { x: 270, y: 230 }, scroll)?.id).toBe('F01');
    expect(hitFeedbackRegion(state, 'revision', 800, 600, { x: 69, y: 180 }, scroll)).toBeUndefined();
  });
  it('does not guess across HTML revisions or viewport sizes', () => {
    const point = { x: 120, y: 240 }, scroll = { x: 0, y: 0 };
    expect(hitFeedbackRegion(state, 'new revision', 800, 600, point, scroll)).toBeUndefined();
    expect(hitFeedbackRegion(state, 'revision', 360, 600, point, scroll)).toBeUndefined();
    expect(hitFeedbackRegion(state, 'revision', 800, 560, point, scroll)).toBeUndefined();
  });
  it('selects the newest overlapping region but never an element annotation', () => {
    const second = { ...state.items[0]!, id: 'F02' };
    const element = { ...second, id: 'F03', target: { ...second.target, kind: 'element' as const } };
    expect(hitFeedbackRegion({ ...state, items: [...state.items, second, element] }, 'revision', 800, 600, { x: 120, y: 240 }, { x: 0, y: 0 })?.id).toBe('F02');
  });
});
