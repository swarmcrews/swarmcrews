// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { captureTarget, type FeedbackState } from './html-feedback.ts';
import { useHtmlFeedbackPreviews } from './use-html-feedback-previews.ts';

it('preserves original target identity and nodes while keeping multiple local previews visible', () => {
  const section = document.createElement('section');
  section.innerHTML = '<h2>Newsletter</h2><p><strong>Subscribe</strong></p>';
  document.body.append(section);
  const p = section.querySelector('p')!;
  const strong = p.firstChild;
  const heading = section.querySelector('h2')!;
  const html = section.outerHTML;
  const state: FeedbackState = { captures: [{ id: 'capture', html, width: 768, height: 560, capturedAt: 'now' }], items: [
    { id: 'F01', captureId: 'capture', target: captureTarget(p, 768, 560), request: 'Text', acceptance: '', scope: 'instance', status: 'ready', preview: { before: 'Subscribe', after: 'Join us' } },
    { id: 'F02', captureId: 'capture', target: captureTarget(heading, 768, 560), request: 'Heading', acceptance: '', scope: 'instance', status: 'ready', preview: { before: 'Newsletter', after: 'Updates' } },
  ] };
  const { result, rerender, unmount } = renderHook(({ value }) => useHtmlFeedbackPreviews(document, value, html, 768, false), { initialProps: { value: state } });
  expect(p.textContent).toBe('Join us'); expect(heading.textContent).toBe('Updates');
  expect(result.current.noteId(p)).toBe('F01');
  expect(result.current.capture(section, 768, 560).text).toBe('NewsletterSubscribe');
  expect(p.textContent).toBe('Join us'); expect(heading.textContent).toBe('Updates');
  rerender({ value: { ...state, items: state.items.slice(1) } });
  expect(p.firstChild).toBe(strong); expect(p.textContent).toBe('Subscribe');
  expect(heading.textContent).toBe('Updates');
  unmount(); expect(section.outerHTML).toBe(html); section.remove();
});
