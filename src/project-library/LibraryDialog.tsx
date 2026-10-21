import { X } from "lucide-react";
import { useEffect, useId, useRef, type FocusEventHandler, type ReactNode } from "react";
import { createPortal } from "react-dom";
/** Header and footer stay put; only the body scrolls, so Close and commit actions are always reachable. */
export function LibraryDialog({ title, titleContent, children, footer, onClose, busy = false, className, sheet = false, onFocusCapture }: { title: string; titleContent?: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; busy?: boolean; className?: string; sheet?: boolean; onFocusCapture?: FocusEventHandler<HTMLElement> }) {
  const ref = useRef<HTMLDivElement>(null); const titleId = useId(); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = [...document.body.children].filter(el => el !== ref.current && !el.hasAttribute("inert"));
    background.forEach(el => el.setAttribute("inert", ""));
    ref.current?.querySelector<HTMLElement>('[aria-label="Close"]')?.focus();
    return () => { background.forEach(el => el.removeAttribute("inert")); if (opener?.isConnected) opener.focus(); };
  }, []);
  return createPortal(<div className={`pl-dialog-backdrop${sheet ? " pl-dialog-backdrop--sheet" : ""}`} ref={ref} onMouseDown={e => { if (e.target === ref.current && !busy) close.current(); }} onKeyDown={e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (!busy) close.current(); }
    if (e.key !== "Tab") return;
    const elements = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')].filter(el => !el.closest("[hidden], [inert], fieldset[disabled]"));
    if (e.shiftKey && document.activeElement === elements[0]) { e.preventDefault(); elements.at(-1)?.focus(); }
    else if (!e.shiftKey && document.activeElement === elements.at(-1)) { e.preventDefault(); elements[0]?.focus(); }
  }}><section className={`pl-dialog${className ? ` ${className}` : ""}${sheet ? " pl-dialog--sheet" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onFocusCapture={onFocusCapture}>
    <header><h2 id={titleId} className={titleContent ? "pl-sr-only" : undefined}>{title}</h2>{titleContent}<button type="button" aria-label="Close" disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
    <div className="pl-dialog-body">{children}</div>
    {footer && <footer>{footer}</footer>}
  </section></div>, document.body);
}
