import { createContext, useContext, type ReactNode } from "react";

const DraftReveal = createContext<(() => void) | undefined>(undefined);
/** Retained surfaces reveal their own UI; nested owners also reopen local editors. */
export function NavigationDraftReveal({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  const parent = useContext(DraftReveal);
  return <DraftReveal.Provider value={() => { parent?.(); onOpen(); }}>{children}</DraftReveal.Provider>;
}

/** Explicit, source-owned navigation contracts. Saved editor text is not a draft.
 * Markers travel with their surface (including portals/retained hidden surfaces),
 * so unmount removes ownership without a separate global registry lifecycle.
 */
export function NavigationDraft({ scope, dirty = false, pending = false, failed = false, onOpen }: {
  scope: string; dirty?: boolean; pending?: boolean; failed?: boolean; onOpen?: () => void;
}) {
  const reveal = useContext(DraftReveal);
  const state = pending ? "pending" : failed ? "failed" : dirty ? "dirty" : undefined;
  return <span hidden data-navigation-scope={scope} data-navigation-state={state} onClick={event => { event.stopPropagation(); reveal?.(); onOpen?.(); }} />;
}
const draftSelector = '[data-navigation-state="dirty"], [data-navigation-state="pending"], [data-navigation-state="failed"]';
export function hasNavigationDraft(root: ParentNode | null) {
  return !!root?.querySelector(draftSelector);
}
export function openNavigationDraft(root: ParentNode = document) {
  const marker = root.querySelector<HTMLElement>(draftSelector);
  marker?.click();
  // Wait for retained surfaces to reveal and the confirmation to restore focus.
  requestAnimationFrame(() => {
    let owner = marker?.parentElement;
    while (owner && owner !== document.body) {
      const input = [...owner.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"]'),
        ...owner.querySelectorAll<HTMLElement>('input:not([type="hidden"])')]
        .find(element => !element.closest('[hidden], [inert]') && !element.matches(':disabled'));
      if (input) { input.focus(); return; }
      owner = owner.parentElement;
    }
  });
}
