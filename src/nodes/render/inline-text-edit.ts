/** Host-created plaintext editing only. Published HTML is still sanitized and
 * the iframe remains script/network/navigation blocked. No HTML is inserted. */
export function startInlineTextEdit(el: HTMLElement, initial: string, onChange: (text: string) => void, onFinish: () => void, onCancel: () => void) {
  const doc = el.ownerDocument;
  const children = Array.from(el.childNodes);
  const attributes = ['contenteditable', 'role', 'aria-label', 'tabindex', 'spellcheck'].map(name => [name, el.getAttribute(name)] as const);
  const originalStyle = el.getAttribute('style');
  el.replaceChildren(doc.createTextNode(initial));
  el.setAttribute('contenteditable', 'plaintext-only');
  el.setAttribute('role', 'textbox');
  el.setAttribute('aria-label', 'Edit selected text');
  el.setAttribute('tabindex', '0');
  el.setAttribute('spellcheck', 'true');
  el.style.userSelect = 'text'; el.style.cursor = 'text'; el.style.whiteSpace = 'pre-wrap';
  const selection = () => doc.defaultView?.getSelection();
  function input() {
    const raw = el.innerText ?? el.textContent ?? '';
    const value = raw.slice(0, 4000);
    if (raw.length > 4000) {
      el.replaceChildren(doc.createTextNode(value));
      const range = doc.createRange(); range.selectNodeContents(el); range.collapse(false);
      selection()?.removeAllRanges(); selection()?.addRange(range);
    }
    onChange(value);
  }
  const paste = (event: ClipboardEvent) => {
    event.preventDefault();
    const value = event.clipboardData?.getData('text/plain') ?? '';
    const sel = selection();
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    if (range && el.contains(range.commonAncestorContainer)) {
      range.deleteContents(); const node = doc.createTextNode(value); range.insertNode(node);
      range.setStartAfter(node); range.collapse(true); sel?.removeAllRanges(); sel?.addRange(range);
    } else el.append(doc.createTextNode(value));
    input();
  };
  const drop = (event: DragEvent) => event.preventDefault();
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') onCancel(); else onFinish();
    }
  };
  el.addEventListener('input', input); el.addEventListener('paste', paste); el.addEventListener('drop', drop); el.addEventListener('keydown', key); el.addEventListener('blur', onFinish);
  let stopped = false; let restored = false;
  function stop() {
    if (stopped) return; stopped = true;
    el.removeEventListener('input', input); el.removeEventListener('paste', paste); el.removeEventListener('drop', drop); el.removeEventListener('keydown', key); el.removeEventListener('blur', onFinish);
    for (const [name, value] of attributes) { if (value === null) el.removeAttribute(name); else el.setAttribute(name, value); }
    if (originalStyle === null) el.removeAttribute('style'); else el.setAttribute('style', originalStyle);
    // Keep the user's line breaks visible until the reversible preview is restored.
    el.style.whiteSpace = 'pre-wrap';
  }
  el.focus();
  const range = doc.createRange(); range.selectNodeContents(el); selection()?.removeAllRanges(); selection()?.addRange(range);
  return { stop, restore() {
    if (restored) return; restored = true; stop(); el.replaceChildren(...children);
    if (originalStyle === null) el.removeAttribute('style'); else el.setAttribute('style', originalStyle);
  } };
}
