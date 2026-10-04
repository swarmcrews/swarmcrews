import { act, createRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HarnessListProvider } from "../../use-harness-list.tsx";
import { ActivityLaunchForm } from "./ActivityLaunchForm.tsx";
import { LEADER_DEFAULT_DATA, type LeaderData } from "./types.ts";

describe("ActivityLaunchForm permission authority", () => {
  it("uses only sandbox policy controls for a Codex launch", () => {
    let receive: ((message: unknown) => void) | undefined;
    render(
      <HarnessListProvider connected send={vi.fn()} subscribe={(listener) => {
        receive = listener;
        return () => undefined;
      }}>
        <ActivityLaunchForm
          nodeId="leader-1"
          data={{ ...LEADER_DEFAULT_DATA, harness: "codex", model: "gpt-5.6-sol", orchestrationMode: "direct" }}
          input=""
          slashCommands={[]}
          promptPlaceholder="Describe work"
          submitDisabled={false}
          submitActive={false}
          textareaRef={createRef<HTMLTextAreaElement>()}
          onInputChange={vi.fn()}
          onKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onUpdate={vi.fn()}
        />
      </HarnessListProvider>,
    );
    act(() => receive?.({
      type: "harness_list",
      harnesses: [{
        name: "codex",
        capabilities: {
          mutationInterception: "observe_only", thinking: true, promptCaching: true,
          mcp: true, permissionPrompts: true, resume: true, partialMessages: false,
          builtInFilesystem: true,
          sandboxEnforcement: {
            filesystem: ["read-only", "workspace-write", "unrestricted"],
            approval: true,
          },
        },
        builtInTools: [],
        models: [{ id: "gpt-5.6-sol", label: "GPT-5.6 Sol" }],
        commands: [], agents: [], account: { provider: "openai" },
      }],
    }));

    expect(screen.getByRole("combobox", { name: "Orchestration" })).toHaveValue("auto");
    expect(screen.queryByRole("option", { name: /direct tools only/i })).toBeNull();
    expect(screen.getByRole("option", { name: /Graph — review before start/i })).toHaveValue("plan");
    expect(screen.queryByLabelText("Permissions")).toBeNull();
    expect(screen.getByLabelText("Sandbox approval policy")).toBeInTheDocument();
  });
});


describe("Activity launch readiness", () => {
  it("validates input and availability, locks pending launch, and preserves settings on failure", () => {
    let receive: ((message: unknown) => void) | undefined;
    const submit = vi.fn();
    function Probe() {
      const [input, setInput] = useState("");
      const [pending, setPending] = useState(false);
      const [data, setData] = useState<LeaderData>({ ...LEADER_DEFAULT_DATA, taskName: "My launch" });
      return <>
        <ActivityLaunchForm nodeId="launch-test" data={data} input={input}
          slashCommands={[]} promptPlaceholder="Goal" submitDisabled={false} submitActive
          textareaRef={createRef<HTMLTextAreaElement>()} pending={pending}
          onInputChange={setInput} onKeyDown={() => undefined}
          onSubmit={() => { submit(); setPending(true); }} onUpdate={(patch) => setData({ ...data, ...patch })} />
        <button onClick={() => { setPending(false); setData({ ...data, error: "Launch rejected" }); }}>Reject</button>
      </>;
    }
    render(<HarnessListProvider connected send={() => undefined} subscribe={(listener) => {
      receive = listener; return () => undefined;
    }}><Probe /></HarnessListProvider>);
    expect(screen.getByText("Describe a goal to launch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launch leader" })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Goal"), { target: { value: "My exact goal" } });
    expect(screen.getByText("Checking model availability…")).toBeInTheDocument();
    act(() => receive?.({ type: "harness_list", harnesses: [{
      name: "claude", capabilities: { permissionPrompts: true }, models: [{ id: "opus", label: "Opus" }],
      builtInTools: [], commands: [], agents: [], account: { provider: "anthropic" },
    }] }));
    expect(screen.getByText("Ready to launch")).toBeInTheDocument();
    const launch = screen.getByRole("button", { name: "Launch leader" });
    fireEvent.click(launch); fireEvent.click(launch);
    expect(submit).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Starting leader…" })).toBeDisabled();
    expect(screen.getByPlaceholderText("Goal")).toHaveValue("My exact goal");
    fireEvent.click(screen.getByText("Reject"));
    expect(screen.getByRole("alert")).toHaveTextContent("Launch rejected");
    expect(screen.getByPlaceholderText("Goal")).toHaveValue("My exact goal");
    expect(screen.getByLabelText(/Name/)).toHaveValue("My launch");
    expect(screen.getByRole("button", { name: "Model" })).toHaveTextContent("Opus");
    expect(screen.getByRole("button", { name: "Launch leader" })).toBeEnabled();
  });
});

describe("Activity launch selected safety meaning", () => {
  it("keeps native options and shows their complete selected meaning as descriptions", () => {
    let receive: ((message: unknown) => void) | undefined;
    const update = vi.fn();
    const props = {
      nodeId: "safety", data: { ...LEADER_DEFAULT_DATA, orchestrationMode: "plan" as const, permissionMode: "default" as const },
      input: "Review", slashCommands: [], promptPlaceholder: "Goal", submitDisabled: false, submitActive: true,
      textareaRef: createRef<HTMLTextAreaElement>(), onInputChange: vi.fn(), onKeyDown: vi.fn(), onSubmit: vi.fn(), onUpdate: update,
    };
    render(<HarnessListProvider connected send={vi.fn()} subscribe={(listener) => { receive = listener; return () => undefined; }}>
      <ActivityLaunchForm {...props} />
    </HarnessListProvider>);
    act(() => receive?.({ type: "harness_list", harnesses: [{ name: "claude", capabilities: { permissionPrompts: true },
      models: [{ id: "opus", label: "Opus" }], builtInTools: [], commands: [], agents: [], account: { provider: "anthropic" } }] }));
    expect(screen.getByLabelText("Orchestration")).toHaveAccessibleDescription("Graph — review before start");
    expect(screen.getByLabelText("Permissions")).toHaveAccessibleDescription("Ask — Confirm risky operations");
    expect(screen.getAllByRole("option").filter(option => ["auto", "default", "acceptEdits", "plan", "bypassPermissions"].includes(option.getAttribute("value") ?? ""))).toHaveLength(7);
    fireEvent.change(screen.getByLabelText("Permissions"), { target: { value: "bypassPermissions" } });
    expect(update).toHaveBeenLastCalledWith({ permissionMode: "bypassPermissions" });
    fireEvent.change(screen.getByLabelText("Orchestration"), { target: { value: "auto" } });
    expect(update).toHaveBeenLastCalledWith({ orchestrationMode: "auto" });
  });
});

it("orders task, workspace, model/access before optional settings and preserves draft on disclosure", () => {
  let receive: ((message: unknown) => void) | undefined;
  const update = vi.fn();
  render(<HarnessListProvider connected send={vi.fn()} subscribe={listener => { receive = listener; return () => undefined; }}>
    <ActivityLaunchForm nodeId="order" data={LEADER_DEFAULT_DATA} input="Preserve this exact draft" slashCommands={[]}
      promptPlaceholder="Goal" submitDisabled={false} submitActive textareaRef={createRef<HTMLTextAreaElement>()}
      workspaceControl={<label>Workspace<select aria-label="Workspace"><option>Current project</option></select></label>}
      onInputChange={vi.fn()} onKeyDown={vi.fn()} onSubmit={vi.fn()} onUpdate={update} />
  </HarnessListProvider>);
  act(() => receive?.({ type: "harness_list", harnesses: [{ name: "claude", capabilities: { permissionPrompts: true },
    models: [{ id: "opus", label: "Opus" }], builtInTools: [], commands: [], agents: [], account: { provider: "anthropic" } }] }));
  const before = (first: Element, second: Element) => expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  before(screen.getByPlaceholderText("Goal"), screen.getByLabelText("Workspace"));
  before(screen.getByLabelText("Workspace"), screen.getByLabelText(/Isolated worktree/));
  before(screen.getByLabelText(/Isolated worktree/), screen.getByLabelText("Model"));
  const advanced = screen.getByText("Orchestration & skills").closest("details")!;
  expect(advanced).not.toHaveAttribute("open");
  expect(screen.getByRole("region", { name: "Launch summary" })).toHaveTextContent("Resolved when the session starts");
  fireEvent.click(advanced.querySelector("summary")!);
  expect(advanced).toHaveAttribute("open");
  fireEvent.click(advanced.querySelector("summary")!);
  expect(screen.getByPlaceholderText("Goal")).toHaveValue("Preserve this exact draft");
  expect(update).not.toHaveBeenCalled();
});

describe("Activity launch model picker", () => {
  function setup() {
    let receive: ((message: unknown) => void) | undefined;
    const update = vi.fn();
    function Probe() {
      const [data, setData] = useState<LeaderData>({ ...LEADER_DEFAULT_DATA });
      return <ActivityLaunchForm nodeId="model-picker" data={data} input="Keep my goal"
        slashCommands={[]} promptPlaceholder="Goal" submitDisabled={false} submitActive
        textareaRef={createRef<HTMLTextAreaElement>()} onInputChange={vi.fn()} onKeyDown={vi.fn()}
        onSubmit={vi.fn()} onUpdate={patch => { update(patch); setData(previous => ({ ...previous, ...patch })); }} />;
    }
    render(<HarnessListProvider connected send={vi.fn()} subscribe={listener => {
      receive = listener; return () => undefined;
    }}><Probe /></HarnessListProvider>);
    const publish = (harnesses: unknown[]) => act(() => receive?.({ type: "harness_list", harnesses }));
    publish([
      { name: "claude", capabilities: { thinking: true, permissionPrompts: true },
        models: [{ id: "opus", label: "Opus" }, { id: "haiku", label: "Haiku" }],
        builtInTools: [], commands: [], agents: [], account: { provider: "anthropic" } },
      { name: "codex", capabilities: { thinking: true, permissionPrompts: true },
        models: [{ id: "gpt-5.6-sol", label: "GPT-5.6 Sol" }, { id: "gpt-6-astra", label: "GPT-6 Astra" }],
        builtInTools: [], commands: [], agents: [], account: { provider: "openai" } },
    ]);
    return { update, publish };
  }

  it("uses the shared provider/model picker and commits the harness and model together", () => {
    const { update } = setup();
    expect(screen.queryByRole("combobox", { name: "Model" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    expect(screen.getByRole("dialog", { name: "Model menu" })).toBeVisible();
    expect(screen.getByRole("tab", { name: /Anthropic/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: /OpenAI/ }));
    expect(update).toHaveBeenLastCalledWith({ harness: "codex", model: "gpt-5.6-sol" });
    expect(screen.getByRole("tab", { name: /OpenAI/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: /GPT-6 Astra/ }));
    expect(update).toHaveBeenLastCalledWith({ harness: "codex", model: "gpt-6-astra" });
    expect(screen.getByRole("button", { name: "Model" })).toHaveTextContent("GPT-6 Astra");
    expect(screen.getByPlaceholderText("Goal")).toHaveValue("Keep my goal");
    expect(screen.getByRole("button", { name: "Launch leader" })).toBeEnabled();
    fireEvent.keyDown(screen.getByRole("button", { name: "Model" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Model menu" })).not.toBeInTheDocument();
  });

  it("offers capability-gated reasoning controls inside the picker", () => {
    const { update } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(update).toHaveBeenLastCalledWith({ thinkingConfig: expect.objectContaining({ effort: "max" }) });
    fireEvent.click(screen.getByRole("button", { name: "Hidden" }));
    expect(update).toHaveBeenLastCalledWith({ thinkingConfig: expect.objectContaining({ effort: "max", display: "omitted" }) });
    fireEvent.click(screen.getByRole("checkbox", { name: /Adaptive reasoning/ }));
    expect(update).toHaveBeenLastCalledWith({ thinkingConfig: expect.objectContaining({ enabled: false }) });
    expect(screen.getByRole("button", { name: "Max" })).toBeDisabled();
    expect(screen.getByRole("region", { name: "Launch summary" })).toHaveTextContent("Off");
    fireEvent.click(screen.getByRole("button", { name: "Haiku" }));
    expect(screen.queryByRole("checkbox", { name: /Adaptive reasoning/ })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Launch summary" })).toHaveTextContent("Unavailable");
  });

  it("keeps an unavailable selection visible without allowing a launch", () => {
    const { publish } = setup();
    publish([]);
    expect(screen.getByRole("button", { name: "Model" })).toHaveTextContent("opus");
    expect(screen.getByText("Selected model unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launch leader" })).toBeDisabled();
  });
});
