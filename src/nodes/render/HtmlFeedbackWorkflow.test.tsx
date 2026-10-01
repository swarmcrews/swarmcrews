// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { HtmlArtifactRenderer } from "./ArtifactComponents.tsx";
import { FormSubmissionProvider } from "./FormSubmissionProvider.tsx";

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
function setup() {
  const send = vi.fn();
  const listeners = new Set<(m: unknown) => void>();
  render(<FormSubmissionProvider sessionKey={crypto.randomUUID()} socketSend={send} socketSubscribe={(fn: (m: unknown) => void) => { listeners.add(fn); return () => listeners.delete(fn); }}>
    <HtmlArtifactRenderer c={{ id: crypto.randomUUID(), type: "html-artifact", title: "Newsletter", html: '<h2>Newsletter</h2><p>Subscribe</p>' }} />
  </FormSubmissionProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Review & annotate" }));
  const frame = screen.getByTitle("HTML review viewport") as HTMLIFrameElement;
  const doc = frame.contentDocument!;
  doc.open(); doc.write('<h2>Newsletter</h2><p>Subscribe</p>'); doc.close(); fireEvent.load(frame);
  return { doc, send, listeners };
}
function draft(doc: Document) {
  fireEvent.click(doc.querySelector('p')!);
  fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Give the button more space.' } });
}
it('progressively reveals editing and requires review before sending', () => {
  const { doc, send, listeners } = setup();
  expect(screen.queryByLabelText('What should change?')).not.toBeInTheDocument();
  expect(screen.getByText('Select a target')).toHaveAttribute('aria-current', 'step');
  draft(doc);
  expect(screen.getByText('Write a note')).toHaveAttribute('aria-current', 'step');
  expect(screen.getByLabelText('What should change?')).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'New note' }));
  expect(screen.queryByLabelText('What should change?')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Submit batch/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review 1 note' }));
  expect(screen.getByText('Review & send')).toHaveAttribute('aria-current', 'step');
  expect(screen.getByRole('heading', { name: 'Ready to send?' })).toHaveFocus();
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Submit batch (1 note)' }));
  expect(send).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  const command = send.mock.calls[0]![0];
  act(() => listeners.forEach(fn => fn({ type: 'control_response', command: 'send_message', sessionKey: command.sessionKey, requestId: command.requestId, success: true })));
  expect(screen.getByRole('heading', { name: 'Feedback sent' })).toBeInTheDocument();
  expect(screen.getByText(/Feedback received by the agent/)).toBeInTheDocument();
});
it('keeps auto-saved notes through target, viewport, review and close transitions', () => {
  const { doc } = setup();
  draft(doc);
  fireEvent.click(doc.querySelector('h2')!);
  expect(screen.getByLabelText('What should change?')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Viewport'), { target: { value: '360' } });
  expect(screen.getByLabelText('Viewport')).toHaveValue('360');
  fireEvent.click(screen.getByRole('button', { name: 'Close Newsletter feedback' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review & annotate' }));
  fireEvent.click(screen.getByRole('button', { name: 'Inspect note F01' }));
  expect(screen.getByLabelText('What should change?')).toHaveValue('Give the button more space.');
  fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Latest edit' } });
  expect(screen.getByRole('button', { name: 'Review 1 note' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Close Newsletter feedback' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review & annotate' }));
  expect(screen.getByLabelText('Saved feedback')).toHaveValue('Latest edit');
});

it('keeps saved text-preview intent intact through review and submission', () => {
  const { doc, send } = setup();
  draft(doc);
  fireEvent.click(screen.getByRole('button', { name: 'Edit selected text' }));
  doc.querySelector('p')!.textContent = 'Join us'; fireEvent.input(doc.querySelector('p')!);
  fireEvent.click(screen.getByRole('button', { name: 'New note' }));
  expect(doc.querySelector('p')).toHaveTextContent('Join us');
  fireEvent.click(screen.getByRole('button', { name: 'Inspect note F01' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review 1 note' }));
  expect((screen.getByLabelText('Saved feedback') as HTMLTextAreaElement).value).toContain('Text: “Subscribe” → “Join us”');
  fireEvent.click(screen.getByRole('button', { name: 'Submit batch (1 note)' }));
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]![0].prompt).toContain('After: Join us');
});

it('offers one feedback box and edits replacement wording directly in the preview', () => {
  const { doc, send } = setup();
  fireEvent.click(doc.querySelector('p')!);
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  expect(screen.queryByLabelText('Scope')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit selected text' }));
  const text = doc.querySelector('p')!;
  expect(text).toHaveAttribute('contenteditable', 'plaintext-only');
  text.textContent = 'Join the collection'; fireEvent.input(text);
  fireEvent.blur(text);
  expect(text).not.toHaveAttribute('contenteditable');
  expect(text).toHaveTextContent('Join the collection');
  fireEvent.click(screen.getByRole('button', { name: 'Review 1 note' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit batch (1 note)' }));
  expect(send.mock.calls[0]![0].prompt).toContain('After: Join the collection');
});

it('saves inline edits on blur and keeps multiple previews when selecting elsewhere', () => {
  const { doc, send } = setup();
  const text = doc.querySelector('p')!;
  fireEvent.click(text);
  fireEvent.click(screen.getByRole('button', { name: 'Edit selected text' }));
  text.textContent = 'Join us'; fireEvent.input(text);
  fireEvent.blur(text);
  expect(text).not.toHaveAttribute('contenteditable');
  expect(text).toHaveTextContent('Join us');
  fireEvent.click(doc.querySelector('h2')!);
  fireEvent.click(screen.getByRole('button', { name: 'Edit selected text' }));
  doc.querySelector('h2')!.textContent = 'Updates'; fireEvent.input(doc.querySelector('h2')!);
  fireEvent.blur(doc.querySelector('h2')!);
  expect(text).toHaveTextContent('Join us');
  expect(doc.querySelector('h2')).toHaveTextContent('Updates');
  expect(screen.getByRole('button', { name: 'Review 2 notes' })).toBeEnabled();
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(text);
  expect(screen.getByRole('heading', { name: 'Note F01' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(text).toHaveTextContent('Subscribe');
  expect(doc.querySelector('h2')).toHaveTextContent('Updates');
});

it('cancels the current text edit without losing an earlier saved preview', () => {
  const { doc } = setup();
  const text = doc.querySelector('p')!;
  fireEvent.click(text);
  fireEvent.click(screen.getByRole('button', { name: 'Edit selected text' }));
  text.textContent = ''; fireEvent.input(text);
  expect(screen.getByRole('button', { name: 'Cancel text edit' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel text edit' }));
  expect(text).toHaveTextContent('Subscribe');
  expect(screen.getByRole('button', { name: 'Review 0 notes' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit selected text' }));
  text.textContent = 'Saved preview'; fireEvent.input(text); fireEvent.blur(text);
  fireEvent.click(text);
  fireEvent.click(screen.getByRole('button', { name: 'Edit selected text' }));
  text.textContent = 'Cancel second edit'; fireEvent.input(text);
  fireEvent.keyDown(text, { key: 'Escape' });
  expect(text).toHaveTextContent('Saved preview');
  expect(screen.getByRole('button', { name: 'Review 1 note' })).toBeEnabled();
});

it('autosaves note wording, moves between objects without confirmation, and discards only the selected object', () => {
  const { doc, send } = setup();
  const p = doc.querySelector('p')!;
  const heading = doc.querySelector('h2')!;
  fireEvent.click(p);
  fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'First note' } });
  expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  fireEvent.click(heading);
  expect(screen.getByLabelText('What should change?')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Second note' } });
  fireEvent.click(p);
  expect(screen.getByLabelText('What should change?')).toHaveValue('First note');
  fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Revised first note' } });
  fireEvent.click(screen.getByRole('button', { name: 'Edit selected text' }));
  p.textContent = 'Local preview'; fireEvent.input(p); fireEvent.blur(p);
  fireEvent.click(heading);
  expect(p).toHaveTextContent('Local preview');
  expect(screen.getByLabelText('What should change?')).toHaveValue('Second note');
  fireEvent.click(p);
  expect(screen.getByLabelText('What should change?')).toHaveValue('Revised first note');
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(p).toHaveTextContent('Subscribe');
  expect(screen.getByRole('button', { name: 'Review 1 note' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Close Newsletter feedback' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review & annotate' }));
  expect(screen.getByLabelText('Saved feedback')).toHaveValue('Second note');
  expect(send).not.toHaveBeenCalled();
});
