import { memo, type ComponentType } from "react";
import type { NodeRenderProps } from "./types.ts";

type Props = NodeRenderProps & {
  renderer: ComponentType<NodeRenderProps>;
  hiddenForDrag: boolean;
};

/** Keep live content mounted and responsive to data while its preview moves. */
export const CanvasNodeContent = memo(function CanvasNodeContent({
  renderer: Renderer, hiddenForDrag: _hiddenForDrag, ...props
}: Props) {
  return <Renderer {...props} />;
}, (previous, next) => {
  for (const key of Object.keys(next) as (keyof Props)[]) {
    if (key === "node" && previous.hiddenForDrag && next.hiddenForDrag) {
      // Only geometry owned by the outer canvas card may be skipped. Render
      // data, size, identity, and all callbacks still invalidate the content.
      const a = previous.node, b = next.node;
      if (a.id !== b.id || a.type !== b.type || a.data !== b.data || a.size !== b.size) return false;
    } else if (!Object.is(previous[key], next[key])) return false;
  }
  return Object.keys(previous).length === Object.keys(next).length;
});
