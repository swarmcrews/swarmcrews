// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { startInlineTextEdit } from './inline-text-edit.ts';

describe('host-owned inline text editing', () => {
  it('edits plain text, bounds input, and restores the exact nodes and attributes', () => {
    const el = document.createElement('p');
    const strong = document.createElement('strong'); strong.textContent = 'Subscribe'; el.append(strong);
    el.setAttribute('aria-label', 'Original label'); document.body.append(el);
    const change = vi.fn(); const finish = vi.fn(); const cancel = vi.fn();
    const session = startInlineTextEdit(el, 'Subscribe', change, finish, cancel);
    expect(el).toHaveAttribute('contenteditable', 'plaintext-only');
    expect(el).toHaveFocus();
    el.textContent = 'Join us'; fireEvent.input(el);
    expect(change).toHaveBeenLastCalledWith('Join us');
    el.textContent = 'x'.repeat(5000); fireEvent.input(el);
    expect(change).toHaveBeenLastCalledWith('x'.repeat(4000));
    fireEvent.keyDown(el, { key: 'Escape' }); expect(cancel).toHaveBeenCalledOnce();
    fireEvent.blur(el); expect(finish).toHaveBeenCalledOnce();
    session.stop(); expect(el).not.toHaveAttribute('contenteditable');
    expect(el.style.whiteSpace).toBe('pre-wrap');
    expect(el).toHaveAttribute('aria-label', 'Original label');
    session.restore(); expect(el.firstChild).toBe(strong); expect(el).toHaveTextContent('Subscribe');
    expect(el).not.toHaveAttribute('style');
    el.remove();
  });
  it('accepts pasted text without inserting HTML and blocks drops', () => {
    const el = document.createElement('p'); el.textContent = 'Before'; document.body.append(el);
    const change = vi.fn(); const session = startInlineTextEdit(el, 'Before', change, vi.fn(), vi.fn());
    fireEvent.paste(el, { clipboardData: { getData: (type: string) => type === 'text/plain' ? '<img src=x onerror=evil()>' : '<script>evil()</script>' } });
    expect(el.querySelector('img,script')).toBeNull();
    expect(el.textContent).toBe('<img src=x onerror=evil()>');
    const drop = new Event('drop', { bubbles: true, cancelable: true }); el.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    session.restore(); expect(el.textContent).toBe('Before'); el.remove();
  });
});
