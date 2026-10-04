import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./confirm-modal.css";

export interface ConfirmModalAction {
  label: string;
  variant?: "primary" | "danger" | "ghost";
  onClick: () => void;
}

interface ConfirmModalProps {
  title: string;
  description?: ReactNode;
  actions: ConfirmModalAction[];
  onClose: () => void;
}

export function ConfirmModal({ title, description, actions, onClose }: ConfirmModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Portal outside transformed canvas nodes; keep background controls inert.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = [...document.body.children].filter((element) =>
      element !== backdropRef.current && !element.hasAttribute("inert"));
    background.forEach((element) => element.setAttribute("inert", ""));
    cancelRef.current?.focus();
    return () => {
      background.forEach((element) => element.removeAttribute("inert"));
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !backdropRef.current?.closest("[inert]")) {
        e.preventDefault(); e.stopImmediatePropagation(); onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  return createPortal(
    <div
      ref={backdropRef}
      className="confirm-modal-backdrop"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
        )].filter((element) => !element.closest('[hidden], [inert], [aria-hidden="true"]'));
        const first = buttons[0];
        const last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === backdropRef.current) onClose();
      }}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--overlay-bg)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-panel)",
          padding: "20px 24px",
          minWidth: 0,
          width: "min(420px, 100%)",
          maxHeight: "100%",
          overflowY: "auto",
          overflowWrap: "anywhere",
          boxShadow: "var(--shadow-lg)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div id={titleId} style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-sans)" }}>
          {title}
        </div>

        {description && (
          <div id={descriptionId} style={{ fontSize: ".875rem", color: "var(--text-secondary)", lineHeight: 1.5, fontFamily: "var(--font-sans)" }}>
            {description}
          </div>
        )}

        <div className="confirm-modal-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            style={{
              ...buttonBase,
              background: "transparent",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-default)",
            }}
          >
            Cancel
          </button>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              style={{
                ...buttonBase,
                ...(action.variant === "danger" ? dangerStyle : action.variant === "ghost" ? ghostStyle : primaryStyle),
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const buttonBase: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: "var(--radius-control)",
  maxWidth: "100%",
  whiteSpace: "normal",
  fontSize: ".8125rem",
  fontWeight: 500,
  fontFamily: "var(--font-sans)",
  cursor: "pointer",
  border: "none",
  transition: "background 0.15s, opacity 0.15s",
};

const primaryStyle: React.CSSProperties = {
  background: "var(--accent)",
  color: "var(--text-on-accent)",
  border: "1px solid var(--accent)",
};

const dangerStyle: React.CSSProperties = {
  background: "var(--danger-color)",
  color: "var(--text-on-status)",
  border: "1px solid var(--danger-color)",
};

const ghostStyle: React.CSSProperties = {
  background: "var(--state-hover)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-default)",
};
