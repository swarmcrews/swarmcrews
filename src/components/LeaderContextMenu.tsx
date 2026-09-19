import { useEffect, useLayoutEffect, useRef } from "react";
import { Copy, Crosshair, FolderInput, Layers, Maximize2, Network } from "lucide-react";
import type { CanvasNode, Position } from "../types.ts";
import type { LeaderData } from "../nodes/leader/types.ts";
import { zoneLeaderLabel, zoneLeaderState } from "../canvas-zones.ts";
import { requestLeaderFullscreen } from "../leader-fullscreen-request.ts";
import { ViewportOverlay } from "./ViewportOverlay.tsx";
import "./leader-context-menu.css";

interface LeaderContextMenuProps {
  node: CanvasNode;
  position: Position;
  onClose: () => void;
  onFocusNode?: ((id: string) => void) | undefined;
  onDuplicateSetup?: ((id: string) => void) | undefined;
  onOpenSystemModel?: ((id: string) => void) | undefined;
  onMoveToZone?: ((id: string) => void) | undefined;
}

export function LeaderContextMenu({ node, position, onClose, onFocusNode, onDuplicateSetup,
  onOpenSystemModel, onMoveToZone }: LeaderContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const data = node.data as Partial<LeaderData>;
  const state = zoneLeaderState(node);
  const actions = [
    { label: "Open fullscreen", description: "Expand the conversation", icon: Maximize2,
      run: requestLeaderFullscreen, group: "view" },
    ...(onFocusNode ? [{ label: "Center on canvas", icon: Crosshair, run: onFocusNode, group: "view" }] : []),
    ...(onDuplicateSetup ? [{ label: "Duplicate setup", description: "New leader with the same configuration",
      icon: Copy, run: onDuplicateSetup, group: "setup" }] : []),
    ...(onOpenSystemModel && data.sessionKey ? [{ label: "Open system model", icon: Network,
      run: onOpenSystemModel, group: "setup" }] : []),
    ...(onMoveToZone ? [{ label: "Move to workspace…", icon: FolderInput, run: onMoveToZone, group: "organize" }] : []),
  ];

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))}px`;
  }, [position, actions.length]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const outside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const keydown = (event: KeyboardEvent) => {
      // Keep canvas shortcuts (especially Delete) out of this menu.
      event.stopPropagation();
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") event.preventDefault();
        returnFocusRef.current?.focus({ preventScroll: true });
        onClose();
        return;
      }
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : event.key === "ArrowDown" ? (index + 1) % items.length
        : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length : null;
      if (next !== null) {
        event.preventDefault();
        items[next]?.focus();
      }
    };
    const wheel = (event: WheelEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("mousedown", outside);
    window.addEventListener("contextmenu", outside);
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("wheel", wheel, { passive: true });
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("contextmenu", outside);
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return <ViewportOverlay zIndex={1100}>
    <div ref={menuRef} className="leader-context-menu" role="menu" aria-label="Leader actions"
      style={{ left: position.x, top: position.y }}
      onMouseDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
      <div className="leader-context-menu__header">
        <span className="leader-context-menu__avatar"><Layers size={18} aria-hidden="true" /></span>
        <div className="leader-context-menu__identity">
          <span className="leader-context-menu__eyebrow">Leader <span>· {state}</span></span>
          <strong title={zoneLeaderLabel(node)}>{zoneLeaderLabel(node)}</strong>
        </div>
      </div>
      {actions.map((action, index) => <div key={action.label} role="none">
        {index > 0 && actions[index - 1]?.group !== action.group && <div role="separator" className="leader-context-menu__separator" />}
        <button type="button" role="menuitem" className="leader-context-menu__item"
          onClick={() => { onClose(); action.run(node.id); }}>
          <action.icon size={16} aria-hidden="true" />
          <span>{action.label}{"description" in action && <small>{action.description}</small>}</span>
        </button>
      </div>)}
      <div className="leader-context-menu__footer"><span>↑ ↓ Navigate</span><span>Esc Close</span></div>
    </div>
  </ViewportOverlay>;
}
