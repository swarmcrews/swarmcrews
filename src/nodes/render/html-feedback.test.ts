// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { captureTarget, locateTarget, previewText, feedbackMarkdown, feedbackPayload, reviewDocument } from "./html-feedback.ts";

describe("HTML feedback evidence", () => {
  it("captures bounded observations separately from requests and matches conservatively", () => {
    document.body.innerHTML = '<section><h2>Newsletter</h2><p id="signup">Subscribe</p></section>';
    const target = captureTarget(document.querySelector('p')!, 800, 600);
    expect(target).toMatchObject({ kind: 'element', tag: 'p', stableId: 'signup', text: 'Subscribe', section: 'Newsletter' });
    expect(locateTarget(document, target)).toBe(document.querySelector('p'));
    document.querySelector('p')!.textContent = 'Changed';
    expect(locateTarget(document, target)).toBeNull();
  });
  it("does not silently choose among duplicate visible targets", () => {
    document.body.innerHTML = '<p>Same</p><p>Same</p>';
    expect(locateTarget(document, captureTarget(document.querySelector('p')!, 800, 600))).toBeNull();
  });
  it("previews text as text, restores child structure, and never interprets HTML", () => {
    const element = document.createElement('p');
    element.innerHTML = '<strong>Old</strong> wording';
    const originalChild = element.firstChild;
    const undo = previewText(element, '<img src=x onerror=alert(1)>');
    expect(element.querySelector('img')).toBeNull();
    undo();
    expect(element.firstChild).toBe(originalChild);
    expect(element.textContent).toBe('Old wording');
  });
  it("exports original wording, explicit acceptance and bounded capture metadata without full HTML in the agent prompt", () => {
    const state = { captures: [{ id: 'r1', html: '<p>private large source</p>', capturedAt: 'now', width: 800, height: 600 }], items: [{ id: 'F01', captureId: 'r1', request: 'Make this feel less crowded.', scope: 'instance' as const, acceptance: '', status: 'ready' as const, target: { kind: 'region' as const, bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, scroll: { x: 0, y: 0 } } }] };
    const markdown = feedbackMarkdown('html-1', state);
    expect(markdown).toContain('Make this feel less crowded.');
    expect(markdown).not.toContain('48px');
    expect(markdown).toContain('F01');
    expect(JSON.stringify(feedbackPayload('html-1', state))).not.toContain('private large source');
  });
  it("adds an independent restrictive CSP even for stale restored artifacts", () => {
    const html = reviewDocument('<html><head></head><body><script>bad()</script></body></html>');
    expect(html).toContain('Content-Security-Policy');
    expect(html).not.toContain('<script>');
    expect(html).toContain("script-src 'none'");
    expect(html).toContain("connect-src 'none'");
  });
});
