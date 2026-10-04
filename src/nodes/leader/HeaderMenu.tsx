import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  Copy,
  Download,
  MoreHorizontal,
  Network,
  RotateCcw,
  Save,
} from "lucide-react";
import type { LeaderData } from "./types.ts";

/**
 * Overflow menu for secondary Leader actions. The visual treatment mirrors
 * the project Settings popover: one elevated surface, clear grouping, and
 * comfortably sized controls.
 */
export function HeaderMenu({
  onReset,
  onExportLog,
  onDuplicateSetup,
  onOpenSystemModel,
  onSavePreset,
  data,
}: {
  onReset: () => void;
  onExportLog: () => void;
  onDuplicateSetup?: (() => void) | undefined;
  onOpenSystemModel?: (() => void) | undefined;
  onSavePreset?:
    | ((input: {
        name: string;
        description?: string;
        systemPromptPrefix?: string;
      }) => boolean)
    | undefined;
  data: LeaderData;
}) {
  const [open, setOpen] = useState(false);
  const [saveFormOpen, setSaveFormOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetDescription, setPresetDescription] = useState("");
  const [presetSystemPromptPrefix, setPresetSystemPromptPrefix] = useState("");
  const [popoverPosition, setPopoverPosition] = useState<{
    left: number;
    maxHeight: number;
    top: number;
    width: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setSaveFormOpen(false);
    setPopoverPosition(null);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // BODY portals do not inherit their Canvas owner's inert/hidden state.
    // Retire the portal on foreground handoff without restoring background focus.
    const retireBackgroundPortal = () => {
      const trigger = triggerRef.current;
      if (!trigger || trigger.closest("[inert], [hidden]")
        || (document.querySelector(".leader-fullscreen-overlay")
          && !trigger.closest(".leader-fullscreen-overlay"))) close();
    };
    const observer = new MutationObserver(retireBackgroundPortal);
    observer.observe(document.body, { childList: true, subtree: true,
      attributes: true, attributeFilter: ["hidden", "inert"] });
    retireBackgroundPortal();
    const closeOnWheel = () => close();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const trigger = triggerRef.current;
      if (!trigger || trigger.closest("[inert], [hidden]")) return;
      const surface = event.target instanceof Element
        ? event.target.closest('[role="dialog"], [role="menu"]') : null;
      if (surface && surface !== popoverRef.current && !surface.contains(trigger)) return;
      // Consume this nested dismissal before the outer cockpit observes the now-closed menu.
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    window.addEventListener("wheel", closeOnWheel, { passive: true, once: true });
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      observer.disconnect();
      window.removeEventListener("wheel", closeOnWheel);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [close, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;

      const viewportPadding = 10;
      const preferredWidth = 15.5 * parseFloat(getComputedStyle(document.documentElement).fontSize);
      const gap = 7;
      const triggerRect = trigger.getBoundingClientRect();
      const leaderRect = trigger.closest(".leader-node")?.getBoundingClientRect();
      const width = Math.min(
        preferredWidth,
        Math.max(200, (leaderRect?.width ?? preferredWidth + 20) - 20),
        window.innerWidth - viewportPadding * 2,
      );
      const left = Math.min(
        window.innerWidth - width - viewportPadding,
        Math.max(viewportPadding, triggerRect.right - width),
      );
      const availableBelow =
        window.innerHeight - triggerRect.bottom - gap - viewportPadding;
      const availableAbove = triggerRect.top - gap - viewportPadding;
      const measuredHeight = popover.scrollHeight;
      const openAbove =
        measuredHeight > availableBelow && availableAbove > availableBelow;
      const maxHeight = Math.max(120, openAbove ? availableAbove : availableBelow);
      const top = openAbove
        ? Math.max(viewportPadding, triggerRect.top - gap - Math.min(measuredHeight, maxHeight))
        : triggerRect.bottom + gap;

      setPopoverPosition({ left, maxHeight, top, width });
    };
    position();
    window.addEventListener("resize", position);
    const rootObserver = new MutationObserver(position);
    rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    const sizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    if (popoverRef.current) sizeObserver?.observe(popoverRef.current);
    return () => {
      window.removeEventListener("resize", position);
      rootObserver.disconnect(); sizeObserver?.disconnect();
    };
  }, [open, saveFormOpen]);

  const positioned = popoverPosition !== null;
  useLayoutEffect(() => {
    if (!open || !positioned) return;
    // The first commit is visibility:hidden for measurement. Focus only its visible commit,
    // not an animation frame that may precede readiness; subsequent resize must retain input focus.
    popoverRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, positioned]);

  const overlay = open ? (
    <>
      <div
        className="leader-header-menu__backdrop"
        onClick={() => close()}
        aria-hidden="true"
      />
      <div
        ref={popoverRef}
        className="leader-header-menu__popover"
        role="menu"
        aria-label="Leader actions"
        data-scroll-capture
        onMouseDown={(event) => event.stopPropagation()}
        // Keep native list scrolling without triggering the outside-wheel dismissal.
        onWheel={(event) => event.stopPropagation()}
        style={{
          overscrollBehavior: "contain",
          left: popoverPosition?.left ?? 0,
          maxHeight: popoverPosition?.maxHeight,
          top: popoverPosition?.top ?? 0,
          visibility: popoverPosition ? "visible" : "hidden",
          width: popoverPosition?.width,
        }}
      >
        <div className="leader-header-menu__label">Leader actions</div>

        {onSavePreset && (
          <>
            <MenuItem
              icon={<Save size={14} />}
              onClick={() => setSaveFormOpen((value) => !value)}
              expanded={saveFormOpen}
              trailing={
                <ChevronDown
                  size={12}
                  className="leader-header-menu__chevron"
                  data-open={saveFormOpen}
                />
              }
            >
              Save as preset
            </MenuItem>
            {saveFormOpen && (
              <div className="leader-header-menu__form">
                <label>
                  <span>Name</span>
                  <input
                    value={presetName}
                    onChange={(event) => setPresetName(event.currentTarget.value)}
                    placeholder="My leader preset"
                    autoFocus
                  />
                </label>
                <label>
                  <span>Description</span>
                  <input
                    value={presetDescription}
                    onChange={(event) =>
                      setPresetDescription(event.currentTarget.value)
                    }
                    placeholder="What this setup is for"
                  />
                </label>
                <label>
                  <span>System prompt prefix</span>
                  <textarea
                    value={presetSystemPromptPrefix}
                    onChange={(event) =>
                      setPresetSystemPromptPrefix(event.currentTarget.value)
                    }
                    placeholder="Optional instructions"
                    rows={3}
                  />
                </label>
                <button
                  type="button"
                  className="leader-header-menu__save"
                  onClick={() => {
                    if (!presetName.trim()) return;
                    const saved = onSavePreset({
                      name: presetName,
                      description: presetDescription,
                      systemPromptPrefix: presetSystemPromptPrefix,
                    });
                    if (!saved) return;
                    close();
                    setPresetName("");
                    setPresetDescription("");
                    setPresetSystemPromptPrefix("");
                  }}
                  disabled={!presetName.trim()}
                >
                  Save preset
                </button>
              </div>
            )}
          </>
        )}

        {onDuplicateSetup && (
          <MenuItem
            icon={<Copy size={14} />}
            onClick={() => {
              onDuplicateSetup();
              close();
            }}
          >
            Duplicate setup
          </MenuItem>
        )}
        {onOpenSystemModel && data.sessionKey && (
          <MenuItem
            icon={<Network size={14} />}
            onClick={() => {
              onOpenSystemModel();
              close();
            }}
          >
            Open system model
          </MenuItem>
        )}
        <MenuItem
          icon={<Download size={14} />}
          onClick={() => {
            onExportLog();
            close();
          }}
        >
          Export log
        </MenuItem>

        {data.sessionKey && (
          <>
            <div className="leader-header-menu__divider" />
            <MenuItem
              icon={<RotateCcw size={14} />}
              tone="danger"
              onClick={() => {
                onReset();
                close();
              }}
            >
              Reset session
            </MenuItem>
          </>
        )}
      </div>
    </>
  ) : null;

  return (
    <div className="leader-header-menu">
      <button
        ref={triggerRef}
        type="button"
        className="leader-node__icon-button"
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        aria-label="More leader actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
      >
        <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
      </button>

      {overlay && createPortal(overlay, document.body)}
    </div>
  );
}

function MenuItem({
  children,
  icon,
  trailing,
  onClick,
  tone = "default",
  expanded,
}: {
  children: ReactNode;
  icon: ReactNode;
  trailing?: ReactNode;
  onClick: () => void;
  tone?: "default" | "danger";
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="leader-header-menu__item"
      data-tone={tone}
      onClick={onClick}
      aria-expanded={expanded}
    >
      <span className="leader-header-menu__item-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
      {trailing}
    </button>
  );
}
