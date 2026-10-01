import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAuthToken } from "../api.ts";
import type { SocketSubscribe } from "../use-socket.ts";
import { SessionChatScreen, type SessionViewMemory } from "./SessionChatScreen.tsx";

const subscribe = (() => () => {}) as SocketSubscribe;
const session = { sessionKey: "iteration", sessionId: "provider-id", status: "completed", role: "leader" as const,
  cwd: "/work/project", projectId: "project" };

function mockProject() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const body = url.endsWith("/auth/token") ? { token: "test" }
      : url.endsWith("/settings") ? { dashboardLeaderActions: [
        { id: "audit", name: "Custom audit", prompt: "Audit the next iteration.", icon: "search", skillIds: ["audit-skill", "missing"] },
      ] }
      : url.endsWith("/skills") ? [{ id: "audit-skill", name: "Audit skill", description: "Review carefully", category: "code",
        icon: "search", accentColor: "#123456", template: "Audit {{target}} thoroughly.",
        variables: [{ name: "target", label: "Target", type: "text", required: true }] }]
      : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

afterEach(() => { vi.restoreAllMocks(); clearAuthToken(); });

describe("mobile iteration commands", () => {
  it("inserts project commands and sends configured skills with the next iteration", async () => {
    const fetch = mockProject();
    const send = vi.fn();
    render(<SessionChatScreen sessionKey={session.sessionKey} session={session} subscribe={subscribe} send={send} onBack={() => {}} />);
    const button = screen.getByRole("button", { name: "/ Commands" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(fetch).toHaveBeenCalledWith("/api/projects/project/settings", expect.anything());
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("option", { name: /Custom audit/ }));
    const input = screen.getByLabelText("Message");
    expect(input).toHaveValue("Audit the next iteration.");
    expect(input).toHaveFocus();
    expect(send.mock.calls.some(([message]) => message.type === "send_message")).toBe(false);
    expect(screen.getByText(/Unavailable skills were not armed: missing/)).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Command skills/ }));
    fireEvent.change(screen.getByLabelText(/Target/), { target: { value: "tests" } });
    fireEvent.click(screen.getByRole("button", { name: "Close skills" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: "send_message", sessionKey: "iteration", displayPrompt: "Audit the next iteration.",
      prompt: expect.stringContaining("Audit tests thoroughly."), skillIds: ["audit-skill"], skillValues: { "audit-skill": { target: "tests" } },
    }));
    expect(input).toHaveValue("");
  });

  it("filters aliases and lets Ctrl+Enter send after selection without extra skill overrides", async () => {
    mockProject();
    const send = vi.fn();
    render(<SessionChatScreen sessionKey={session.sessionKey} session={session} subscribe={subscribe} send={send} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "/ Commands" })).toBeEnabled());
    const input = screen.getByLabelText("Message");
    fireEvent.change(input, { target: { value: "/crew" } });
    expect(screen.getByRole("option", { name: /Graph/ })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(send).toHaveBeenCalledWith({ type: "send_message", sessionKey: "iteration",
      prompt: expect.stringContaining("Use the Task Graph feature"), displayPrompt: expect.stringContaining("Use the Task Graph feature") });
  });

  it("keeps command skills with a saved draft across remounts", async () => {
    mockProject();
    const memory: SessionViewMemory = {};
    const props = { sessionKey: session.sessionKey, session, subscribe, send: vi.fn(), onBack: () => {}, memory };
    const first = render(<SessionChatScreen {...props} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "/ Commands" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "/ Commands" }));
    fireEvent.click(screen.getByRole("option", { name: /Custom audit/ }));
    first.unmount();
    render(<SessionChatScreen {...props} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Command skills/ })).toBeInTheDocument());
    expect(screen.getByLabelText("Message")).toHaveValue("Audit the next iteration.");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("hides the picker offline and does not carry selections into a different session", async () => {
    mockProject();
    const props = { subscribe, send: vi.fn(), onBack: () => {} };
    const { rerender } = render(<SessionChatScreen {...props} sessionKey={session.sessionKey} session={session} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "/ Commands" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "/audit" } });
    rerender(<SessionChatScreen {...props} sessionKey={session.sessionKey} session={session} connected={false} />);
    expect(screen.getByRole("button", { name: "/ Commands" })).toBeDisabled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    rerender(<SessionChatScreen {...props} sessionKey={session.sessionKey} session={session} />);
    fireEvent.click(screen.getByRole("option", { name: /Custom audit/ }));
    expect(screen.getByRole("button", { name: /Command skills/ })).toBeInTheDocument();
    rerender(<SessionChatScreen {...props} sessionKey="other" session={{ ...session, sessionKey: "other", projectId: null }} />);
    expect(screen.getByLabelText("Message")).toHaveValue("");
    expect(screen.queryByRole("button", { name: /Command skills/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "/ Commands" }));
    expect(screen.queryByRole("option", { name: /Custom audit/ })).not.toBeInTheDocument();
  });

  it("does not expose leader commands in minion chats", () => {
    const fetch = mockProject();
    render(<SessionChatScreen sessionKey="child" session={{ ...session, role: "minion" }} subscribe={subscribe} send={vi.fn()} onBack={() => {}} />);
    expect(screen.queryByRole("button", { name: "/ Commands" })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
