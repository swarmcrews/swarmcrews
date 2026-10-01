import type { FeedbackItem, FeedbackState } from "./html-feedback.ts";

/** Regions are coordinates, not inferred DOM identities. Only hit the exact
 * captured revision/viewport; newest wins when saved regions overlap. */
export function hitFeedbackRegion(state: FeedbackState, html: string, width: number, height: number,
  point: { x: number; y: number }, scroll: { x: number; y: number }): FeedbackItem | undefined {
  return [...state.items].reverse().find(item => {
    if (item.target.kind !== "region") return false;
    const capture = state.captures.find(c => c.id === item.captureId);
    if (capture?.html !== html || capture.width !== width || capture.height !== height) return false;
    const { bounds, scroll: origin } = item.target;
    const x = bounds.x * width + origin.x - scroll.x;
    const y = bounds.y * height + origin.y - scroll.y;
    return point.x >= x && point.x <= x + bounds.width * width && point.y >= y && point.y <= y + bounds.height * height;
  });
}
