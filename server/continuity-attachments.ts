import type { ImageAttachment } from "./session-host-types.ts";
import type { SessionContinuity } from "./session-continuity.ts";

const identity = (image: ImageAttachment) => `${image.mediaType}:${image.data}`;
function rebuild(state: SessionContinuity): void {
  state.attachments = [...new Map([
    ...(state.canvasAttachments ?? []), ...(state.promptAttachments ?? []),
  ].map(image => [identity(image), image])).values()];
}

export function seedContinuityAttachments(state: SessionContinuity, input: {
  canvasAttachments?: ImageAttachment[] | undefined;
  promptAttachments?: ImageAttachment[] | undefined;
}): void {
  if (state.canvasAttachments !== undefined || input.canvasAttachments === undefined) return;
  state.canvasAttachments = input.canvasAttachments;
  state.promptAttachments = input.promptAttachments ?? [];
  rebuild(state);
}

export function replaceCanvasAttachments(state: SessionContinuity, images: ImageAttachment[]): void {
  state.canvasAttachments = images;
  const keys = new Set(images.map(identity));
  // Initial launch attachments arrive before the first out-of-band snapshot.
  state.promptAttachments = (state.promptAttachments ?? []).filter(image => !keys.has(identity(image)));
  rebuild(state);
}

export function captureTurnAttachments(state: SessionContinuity, images: ImageAttachment[]): void {
  const canvas = new Set((state.canvasAttachments ?? []).map(identity));
  const direct = images.filter(image => !canvas.has(identity(image)));
  if (direct.length || !state.promptAttachments) state.promptAttachments = direct;
  rebuild(state);
}
