// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HtmlArtifactRenderer } from "./ArtifactComponents.tsx";
import { FormSubmissionProvider } from "./FormSubmissionProvider.tsx";
import type { HtmlArtifactComponent } from "../../../shared/render-dsl.ts";

const c: HtmlArtifactComponent = { id: "review", type: "html-artifact", html: '<section><h2>Newsletter</h2><p id="signup">Subscribe</p></section>' };
beforeEach(() => {
  localStorage.clear();
  c.id = crypto.randomUUID();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
function openReview() {
  fireEvent.click(screen.getByRole("button", { name: "Review & annotate" }));
  const iframe = screen.getByTitle("HTML review viewport") as HTMLIFrameElement;
  // jsdom doesn't load srcdoc. Populate the browser boundary then dispatch load.
  const doc = iframe.contentDocument!;
  doc.open(); doc.write(c.html); doc.close();
  fireEvent.load(iframe);
  return { iframe, doc };
}
function addNote(doc: Document) {
  fireEvent.click(doc.querySelector("p")!);
  fireEvent.change(screen.getByLabelText("What should change?"), { target: { value: "Make this feel less crowded. Keep the current color." } });
  fireEvent.click(screen.getByRole("button", { name: "New note" }));
}

describe("HTML feedback review loop", () => {
  it('shows note IDs in the inspector, never over the selected content', () => {
    render(<HtmlArtifactRenderer c={c} />);
    const { doc } = openReview();
    addNote(doc);
    fireEvent.click(doc.querySelector('p')!);
    expect(screen.getByRole('heading', { name: 'Note F01' })).toBeInTheDocument();
    const canvas = document.body.querySelector('.hf-canvas')!;
    expect(canvas.querySelector('button')).toBeNull();
    expect(canvas.textContent).toBe('');
    expect(screen.getByRole('group', { name: 'Selection actions' })).not.toHaveTextContent('F01');
    expect(screen.getByRole('button', { name: 'Edit selected text' })).toBeEnabled();
  });
  it('builds a draft batch, reselects objects, edits and deletes notes before explicit submission', () => {
    const send = vi.fn();
    render(<FormSubmissionProvider sessionKey="batch-session" socketSend={send} socketSubscribe={() => () => {}}><HtmlArtifactRenderer c={c} /></FormSubmissionProvider>);
    const { doc } = openReview();
    fireEvent.click(doc.querySelector('p')!);
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Original note' } });
    fireEvent.click(screen.getByRole('button', { name: 'New note' }));
    fireEvent.click(doc.querySelector('h2')!);
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Second note to remove' } });
    fireEvent.click(screen.getByRole('button', { name: 'New note' }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Review 2 notes' })).toBeEnabled();
    fireEvent.click(doc.querySelector('p')!);
    expect(document.body.querySelector('.hf-annotation[data-selected=true]')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Note F01' })).toBeInTheDocument();
    expect(screen.getByLabelText('What should change?')).toHaveValue('Original note');
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Edited note' } });
    expect(screen.getByRole('button', { name: 'Review 2 notes' })).toBeEnabled();
    expect(screen.getByLabelText('What should change?')).toHaveValue('Edited note');
    fireEvent.click(doc.querySelector('h2')!);
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(document.body.querySelectorAll('.hf-annotation')).toHaveLength(1);
    if (screen.queryByRole('button', { name: 'Review 1 note' })) fireEvent.click(screen.getByRole('button', { name: 'Review 1 note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit batch (1 note)' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].prompt).toContain('Edited note');
    expect(send.mock.calls[0]![0].prompt).not.toContain('Original note');
    expect(send.mock.calls[0]![0].prompt).not.toContain('Second note to remove');
    expect(screen.getByRole('button', { name: 'Delete note F01' })).toBeDisabled();
  });
  it('keeps selection visible and auto-saves wording when moving between targets', () => {
    render(<HtmlArtifactRenderer c={c} />);
    const { doc } = openReview();
    addNote(doc);
    fireEvent.click(doc.querySelector('p')!);
    fireEvent.mouseMove(doc.querySelector('h2')!);
    expect(document.body.querySelectorAll('.hf-outline')).toHaveLength(1);
    expect(document.body.querySelectorAll('.hf-hover-outline')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Updated note' } });
    fireEvent.click(doc.querySelector('h2')!);
    expect(screen.getByLabelText('What should change?')).toHaveValue('');
    fireEvent.click(doc.querySelector('p')!);
    expect(screen.getByLabelText('What should change?')).toHaveValue('Updated note');
    expect(document.body.querySelectorAll('.hf-outline')).toHaveLength(1);
    expect(screen.queryByLabelText('Scope')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Keep the color' } });
    const journal = JSON.parse(localStorage.getItem(`html-feedback:v1:standalone:${c.id}`)!);
    expect(journal.items).toHaveLength(1);
    expect(journal.items[0]).toMatchObject({ scope: 'instance', request: 'Keep the color', target: { text: 'Subscribe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('What should change?')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Review 0 notes' })).toBeDisabled();
  });
  it('shows saved evidence without guessing when the captured element cannot be resolved', () => {
    render(<HtmlArtifactRenderer c={c} />);
    const { doc } = openReview();
    addNote(doc);
    doc.querySelector('p')!.textContent = 'Not the captured target';
    fireEvent.click(screen.getByRole('button', { name: 'Inspect note F01' }));
    expect(document.body.querySelector('.hf-outline')).toBeNull();
    expect(screen.getByText(/Target not highlighted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit selected text' })).not.toBeInTheDocument();
  });
  it("saves a target and wording, preserves notes on close, and flags a changed revision", () => {
    const view = render(<HtmlArtifactRenderer c={c} />);
    const { iframe, doc } = openReview();
    expect(iframe).toHaveAttribute("sandbox", "allow-same-origin");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-scripts");
    addNote(doc);
    expect(screen.getByRole("button", { name: "Inspect note F01" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Close HTML artifact feedback/ }));
    openReview();
    expect((screen.getByLabelText("Saved feedback") as HTMLTextAreaElement).value).toContain("Make this feel less crowded");
    const feedbackId = JSON.parse(window.localStorage.getItem(`html-feedback:v1:standalone:${c.id}`)!).items[0].id;
    view.rerender(<HtmlArtifactRenderer c={{ ...c, html: '<p>New revision</p>', feedbackResponses: [{ id: feedbackId, summary: 'Reduced spacing without changing the color.' }] }} />);
    expect(screen.getByText(/needs reattachment/)).toBeInTheDocument();
    expect(screen.getByText('Agent addressed')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review 1 note' }));
    expect(screen.getByRole('button', { name: /Submit batch/ })).toBeDisabled();
    const newFrame = screen.getByTitle('HTML review viewport') as HTMLIFrameElement;
    const newDoc = newFrame.contentDocument!;
    newDoc.open(); newDoc.write('<p>New revision</p>'); newDoc.close(); fireEvent.load(newFrame);
    fireEvent.click(newDoc.querySelector('p')!);
    fireEvent.click(screen.getByRole('button', { name: 'Attach selected target' }));
    expect(screen.queryByText(/needs reattachment/)).not.toBeInTheDocument();
    const journal = JSON.parse(localStorage.getItem(`html-feedback:v1:standalone:${c.id}`)!);
    expect(journal.items[0].previousTargets[0].target.text).toBe('Subscribe');
    view.rerender(<HtmlArtifactRenderer c={{ ...c, id: 'different' }} />);
    openReview();
    expect(screen.queryByRole('button', { name: 'Inspect note F01' })).not.toBeInTheDocument();
  });
  it("previews and undoes text without mutating the published component", () => {
    render(<HtmlArtifactRenderer c={c} />);
    const { doc } = openReview();
    fireEvent.click(doc.querySelector('p')!);
    expect(screen.queryByRole('button', { name: 'Try replacement text' })).not.toBeInTheDocument();
    const edit = screen.getByRole('button', { name: 'Edit selected text' });
    expect(edit.closest('.hf-selection-label')).toHaveTextContent('Selected text');
    expect(edit.closest('.hf-outline')).toBeNull();
    fireEvent.click(edit);
    expect(screen.getByRole('button', { name: 'Cancel text edit' })).toBeInTheDocument();
    doc.querySelector('p')!.textContent = 'Join us'; fireEvent.input(doc.querySelector('p')!);
    expect(doc.querySelector('p')?.textContent).toBe('Join us');
    fireEvent.click(screen.getByRole('button', { name: 'Undo preview' }));
    expect(doc.querySelector('p')?.textContent).toBe('Subscribe');
    expect(c.html).toContain('Subscribe');
  });
  it("only marks sent after a matching receipt, preserves rejection, and scopes the handoff to its session", () => {
    const listeners = new Set<(message: unknown) => void>();
    const subscribe = (fn: (message: unknown) => void) => { listeners.add(fn); return () => listeners.delete(fn); };
    const send = vi.fn();
    const view = render(<FormSubmissionProvider sessionKey="session-A" socketSend={send} socketSubscribe={subscribe}><HtmlArtifactRenderer c={c} /></FormSubmissionProvider>);
    addNote(openReview().doc);
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
    if (screen.queryByRole('button', { name: 'Review 1 note' })) fireEvent.click(screen.getByRole('button', { name: 'Review 1 note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit batch (1 note)' }));
    const command = send.mock.calls[0]![0] as Record<string, unknown>;
    expect(command).toMatchObject({ type: 'send_message', sessionKey: 'session-A' });
    expect(command['prompt']).toContain('Make this feel less crowded. Keep the current color.');
    expect(command['prompt']).toContain('Observed target evidence');
    const receipt = { type: 'control_response', command: 'send_message', sessionKey: 'session-A', requestId: command['requestId'], success: true };
    act(() => listeners.forEach(fn => fn({ ...receipt, sessionKey: 'other' })));
    expect(screen.getByText('Sending feedback…')).toBeInTheDocument();
    act(() => listeners.forEach(fn => fn({ ...receipt, success: false, error: 'Session is busy' })));
    expect(screen.getByText('Session is busy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit batch (1 note)' })).toBeEnabled();
    if (screen.queryByRole('button', { name: 'Review 1 note' })) fireEvent.click(screen.getByRole('button', { name: 'Review 1 note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit batch (1 note)' }));
    act(() => listeners.forEach(fn => fn({ ...receipt, requestId: send.mock.calls[1]![0].requestId })));
    expect(screen.getByText(/Feedback received by the agent/)).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
    view.rerender(<FormSubmissionProvider sessionKey="session-A" socketSend={send} socketSubscribe={subscribe}><HtmlArtifactRenderer c={{ ...c, html: '<p>Updated revision</p>' }} /></FormSubmissionProvider>);
    expect(screen.getByRole('button', { name: 'Verify' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(screen.getByText('User verified')).toBeInTheDocument();
  });
  it("restores local captures after remount without a model or server call", () => {
    const view = render(<HtmlArtifactRenderer c={c} />);
    addNote(openReview().doc);
    view.unmount();
    render(<HtmlArtifactRenderer c={c} />);
    openReview();
    expect(screen.getByRole('button', { name: 'Inspect note F01' })).toBeInTheDocument();
  });
});

it('preserves existing scope and acceptance when editing the single feedback box', () => {
  const initial = { captures: [{ id: 'capture', html: c.html, width: 768, height: 560, capturedAt: new Date().toISOString() }], items: [{ id: 'F01-old', captureId: 'capture', target: { kind: 'region', bounds: { x: 0, y: 0, width: .5, height: .5 }, scroll: { x: 0, y: 0 } }, request: 'Original', acceptance: 'Readable at small sizes', scope: 'component', status: 'ready' }] };
  localStorage.setItem(`html-feedback:v1:standalone:${c.id}`, JSON.stringify(initial));
  render(<HtmlArtifactRenderer c={c} />); openReview();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect note F01' }));
  fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Updated feedback' } });
  const journal = JSON.parse(localStorage.getItem(`html-feedback:v1:standalone:${c.id}`)!);
  expect(journal.items[0]).toMatchObject({ request: 'Updated feedback', scope: 'component', acceptance: 'Readable at small sizes' });
});

it('selects newly drawn regions, reverts to Select, and can reselect even an empty region', () => {
  render(<HtmlArtifactRenderer c={c} />);
  const { doc } = openReview();
  fireEvent.click(screen.getByRole('button', { name: 'Draw region' }));
  fireEvent(doc.body, new MouseEvent('pointerdown', { bubbles: true, clientX: 30, clientY: 30 }));
  fireEvent(doc.body, new MouseEvent('pointerup', { bubbles: true, clientX: 130, clientY: 80 }));
  expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('group', { name: 'Selection actions' })).toHaveTextContent('Selected region');
  // The drag's trailing click must not immediately replace the region selection.
  fireEvent.click(doc.body, { clientX: 130, clientY: 80, detail: 1 });
  expect(screen.getByRole('group', { name: 'Selection actions' })).toHaveTextContent('Selected region');
  fireEvent(doc.body, new MouseEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }));
  fireEvent.click(doc.querySelector('p')!);
  expect(screen.getByRole('group', { name: 'Selection actions' })).toHaveTextContent('Selected text');
  fireEvent.mouseMove(doc.body, { clientX: 60, clientY: 50 });
  expect(document.body.querySelector('.hf-hover-outline')).toHaveStyle({ left: '30px', top: '30px', width: '100px', height: '50px' });
  fireEvent.click(doc.body, { clientX: 60, clientY: 50 });
  expect(screen.getByRole('group', { name: 'Selection actions' })).toHaveTextContent('Selected region');
  expect(screen.getByRole('heading', { name: 'Note F01' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Reduce this gap' } });
  const journal = JSON.parse(localStorage.getItem(`html-feedback:v1:standalone:${c.id}`)!);
  expect(journal.items).toHaveLength(1);
  expect(journal.items[0]).toMatchObject({ request: 'Reduce this gap', target: { kind: 'region' } });
});
