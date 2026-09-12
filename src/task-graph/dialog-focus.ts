/** Keep keyboard navigation inside a modal, including its initial container focus. */
export function containDialogFocus(event: KeyboardEvent, dialog: HTMLElement) {
  if (event.key !== "Tab") return;
  const controls = [...dialog.querySelectorAll<HTMLElement>(
    'button, a[href], input, textarea, select, summary, [tabindex]',
  )].filter((element) => {
    if (element.tabIndex < 0 || element.matches(':disabled') || element.closest('[hidden], [inert]')) return false;
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (ancestor instanceof HTMLDetailsElement && !ancestor.open
        && !ancestor.querySelector('summary')?.contains(element)) return false;
      if (ancestor === dialog) break;
    }
    return true;
  });
  const active = document.activeElement;
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
  if (!controls.some((control) => control === active)
    || (event.shiftKey ? active === first : active === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

/** Dismiss a nested menu before the containing dialog handles Escape or Tab. */
export function dismissDialogMenu(event: KeyboardEvent, dialog: HTMLElement) {
  if (event.key !== "Escape" && event.key !== "Tab") return false;
  const trigger = dialog.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"][aria-expanded="true"]');
  if (!trigger) return false;
  event.preventDefault();
  event.stopPropagation();
  trigger.click();
  trigger.focus();
  return true;
}
