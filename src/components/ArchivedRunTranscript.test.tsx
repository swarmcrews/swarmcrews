import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ArchivedRunTranscript } from "./ArchivedRunTranscript.tsx";

afterEach(() => vi.unstubAllGlobals());
const event = (id: number, text: string) => ({ type: "sdk_event", sessionKey: "run", historyId: id, timestamp: id,
  event: { kind: "text", role: "assistant", text } });
const page = (events = [event(20, "Latest answer")], before: number | null = null) =>
  new Response(JSON.stringify({ events, history: { before, highWater: 20, url: "/api/history/run" } }));

it("retries failed pages without losing messages, deduplicates rows, and keeps chronological order", async () => {
  const fetchHistory = vi.fn().mockResolvedValueOnce(page(undefined, 20))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(page([event(10, "Earlier answer"), event(20, "Latest answer")]));
  vi.stubGlobal("fetch", fetchHistory);
  render(<ArchivedRunTranscript runKey="run" />);
  expect(await screen.findByText("Latest answer")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the saved transcript");
  expect(screen.getByText("Latest answer")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry loading transcript" }));
  const earlier = await screen.findByText("Earlier answer");
  const latest = screen.getByText("Latest answer");
  expect(earlier.compareDocumentPosition(latest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(fetchHistory).toHaveBeenLastCalledWith("/api/history/run?format=json&before=20", expect.anything());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("exposes retry for an HTTP failure on the first page", async () => {
  const fetchHistory = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(page([]));
  vi.stubGlobal("fetch", fetchHistory);
  render(<ArchivedRunTranscript runKey="run" />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry loading transcript" }));
  expect(await screen.findByText("No saved messages for this iteration.")).toBeInTheDocument();
  expect(fetchHistory).toHaveBeenCalledTimes(2);
});

it("aborts on selection changes and ignores late responses from the previous iteration", async () => {
  let resolve!: (response: Response) => void;
  const fetchHistory = vi.fn().mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }))
    .mockResolvedValueOnce(page([event(30, "New selection")]));
  vi.stubGlobal("fetch", fetchHistory);
  const { rerender, unmount } = render(<ArchivedRunTranscript runKey="old" />);
  const firstSignal = fetchHistory.mock.calls[0]![1].signal as AbortSignal;
  rerender(<ArchivedRunTranscript runKey="new" />);
  expect(firstSignal.aborted).toBe(true);
  expect(await screen.findByText("New selection")).toBeInTheDocument();
  await act(async () => resolve(page([event(10, "Stale selection")])));
  expect(screen.queryByText("Stale selection")).not.toBeInTheDocument();
  unmount();
});

it("bounds in-flight requests, aborts on collapse, and survives StrictMode effect replay", async () => {
  let resolve!: (response: Response) => void;
  const fetchHistory = vi.fn().mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValueOnce(page(undefined, 20))
    .mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
  vi.stubGlobal("fetch", fetchHistory);
  const { unmount } = render(<StrictMode><ArchivedRunTranscript runKey="run" /></StrictMode>);
  expect(await screen.findByText("Latest answer")).toBeInTheDocument();
  const loadMore = screen.getByRole("button", { name: "Load earlier messages" });
  fireEvent.click(loadMore);
  fireEvent.click(loadMore);
  expect(loadMore).toBeDisabled();
  expect(fetchHistory).toHaveBeenCalledTimes(3);
  const signal = fetchHistory.mock.calls[2]![1].signal as AbortSignal;
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(page([])));
});
