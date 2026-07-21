import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { FileTree } from "../../src/components/file-tree";
import { AppShell } from "../../src/components/app-shell";
import { ImageView } from "../../src/components/document-view";
import { MermaidBlocks } from "../../src/components/mermaid-blocks";
import { ProjectSwitcher } from "../../src/components/project-switcher";
import { ProjectUnavailable } from "../../src/components/project-unavailable";
import ErrorView from "../../src/app/error";

const mockPush = vi.fn();
const mockMermaidRender = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: (...args: unknown[]) => mockMermaidRender(...args),
  },
}));

const PROJECTS = [
  { id: "alpha", title: "Alpha", homepage: "README.md" },
  { id: "beta", title: "Beta", homepage: "README.md" },
];

const TREE = [
  {
    kind: "directory" as const,
    name: "guide",
    path: "guide",
    children: [{ kind: "markdown" as const, name: "a.md", path: "guide/a.md", size: 10 }],
  },
  { kind: "image" as const, name: "logo.png", path: "logo.png", size: 20 },
  { kind: "attachment" as const, name: "notes.pdf", path: "notes.pdf", size: 30 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockMermaidRender.mockResolvedValue({
    svg: '<svg viewBox="0 0 100 50"><title>diagram</title></svg>',
  });
});

it("switches projects to their homepages", async () => {
  render(<ProjectSwitcher projects={PROJECTS} activeId="alpha" />);
  await userEvent.selectOptions(screen.getByLabelText("Project"), "beta");
  expect(mockPush).toHaveBeenCalledWith("/p/beta/README.md");
});

it("renders directories and document links in the tree", () => {
  render(<FileTree projectId="alpha" nodes={TREE} activePath="guide/a.md" />);
  expect(screen.getByRole("link", { name: "a.md" })).toHaveAttribute(
    "href",
    "/p/alpha/guide/a.md",
  );
  expect(screen.getByRole("link", { name: "guide" })).toHaveAttribute("href", "/p/alpha/guide");
  expect(screen.getByRole("link", { name: "logo.png" })).toHaveAttribute("href", "/p/alpha/logo.png");
  expect(screen.getByRole("link", { name: "notes.pdf" })).toHaveAttribute(
    "href",
    "/api/assets/alpha/notes.pdf",
  );
});

it("traps focus in the mobile drawer and restores it on Escape", async () => {
  const user = userEvent.setup();
  render(
    <AppShell projects={PROJECTS} activeId="alpha" nodes={TREE} activePath="guide/a.md">
      <p>Document</p>
    </AppShell>,
  );
  const trigger = screen.getByRole("button", { name: "Browse documents" });
  await user.click(trigger);
  const close = screen.getByRole("button", { name: "Close" });
  expect(close).toHaveFocus();
  await user.tab({ shift: true });
  expect(within(document.getElementById("mobile-tree")!).getByRole("link", { name: "notes.pdf" })).toHaveFocus();
  await user.tab();
  expect(close).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});

it("previews a deep-linked image through the asset endpoint", () => {
  render(<ImageView projectId="alpha" path="images/logo one.png" />);
  expect(screen.getByRole("img", { name: "logo one.png" })).toHaveAttribute(
    "src",
    "/api/assets/alpha/images/logo%20one.png",
  );
});

it("removes Mermaid temporary error rendering when rendering fails", async () => {
  mockMermaidRender.mockImplementation(
    (_id: string, _source: string, container?: HTMLElement) => {
      const error = document.createElement("p");
      error.textContent = "Syntax error in text";
      (container ?? document.body).append(error);
      return Promise.reject(new Error("bad diagram"));
    },
  );

  render(
    <MermaidBlocks
      html={'<pre class="mermaid" data-mermaid-source="broken"></pre>'}
      path="README.md"
    />,
  );

  expect(await screen.findByText(/diagram could not be rendered/i)).toBeVisible();
  expect(screen.getByText("broken")).toBeVisible();
  expect(screen.queryByText("Syntax error in text")).not.toBeInTheDocument();
  expect(mockMermaidRender).toHaveBeenCalledWith(
    expect.stringMatching(/^mermaid-.*-0$/),
    "broken",
    expect.any(HTMLDivElement),
  );
  expect(screen.queryByRole("button", { name: "Zoom in" })).not.toBeInTheDocument();
});

it("adds accessible icon controls to a successfully rendered Mermaid diagram", async () => {
  const { container } = render(
    <MermaidBlocks
      html={'<pre class="mermaid" data-mermaid-source="flowchart LR\nA --> B"></pre>'}
      path="README.md"
    />,
  );

  const block = container.querySelector<HTMLPreElement>("pre.mermaid")!;
  for (const name of ["Zoom in", "Zoom out", "Reset view", "Pan diagram"]) {
    const button = await within(block).findByRole("button", { name });
    expect(button).toHaveAttribute("title", name);
    expect(button.querySelector("svg")).toBeInTheDocument();
  }
});

it("zooms and resets a Mermaid diagram", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <MermaidBlocks
      html={'<pre class="mermaid" data-mermaid-source="flowchart LR\nA --> B"></pre>'}
      path="README.md"
    />,
  );

  const view = within(container);
  const zoomIn = await view.findByRole("button", { name: "Zoom in" });
  const svg = container.querySelector("pre.mermaid .mermaid-viewport > svg")!;
  await user.click(zoomIn);
  expect(svg).toHaveAttribute("viewBox", "10 5 80 40");

  await user.click(view.getByRole("button", { name: "Zoom out" }));
  expect(svg).toHaveAttribute("viewBox", "0 0 100 50");

  await user.click(zoomIn);
  await user.click(view.getByRole("button", { name: "Reset view" }));
  expect(svg).toHaveAttribute("viewBox", "0 0 100 50");
});

it("supports wheel zoom and pointer dragging in pan mode", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <MermaidBlocks
      html={'<pre class="mermaid" data-mermaid-source="flowchart LR\nA --> B"></pre>'}
      path="README.md"
    />,
  );

  const view = within(container);
  const pan = await view.findByRole("button", { name: "Pan diagram" });
  const viewport = container.querySelector<HTMLElement>(".mermaid-viewport")!;
  const svg = viewport.querySelector("svg")!;
  fireEvent.wheel(viewport, { deltaY: -100 });
  expect(svg).toHaveAttribute("viewBox", "10 5 80 40");

  await user.click(view.getByRole("button", { name: "Reset view" }));
  await user.click(pan);
  expect(pan).toHaveAttribute("aria-pressed", "true");
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 200,
    bottom: 100,
    width: 200,
    height: 100,
    toJSON: () => ({}),
  });
  Object.assign(viewport, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });

  fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 20, clientY: 10 });
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 40, clientY: 20 });
  fireEvent.pointerUp(viewport, { pointerId: 1 });
  expect(svg).toHaveAttribute("viewBox", "-10 -5 100 50");
});

it("normalizes Mermaid source before rendering", async () => {
  render(
    <MermaidBlocks
      html={'<pre class="mermaid" data-mermaid-source="    flowchart LR\r\n      A --> B\n"></pre>'}
      path="README.md"
    />,
  );

  await vi.waitFor(() => expect(mockMermaidRender).toHaveBeenCalled());
  expect(mockMermaidRender).toHaveBeenCalledWith(
    expect.stringMatching(/^mermaid-.*-0$/),
    "flowchart LR\n  A --> B",
    expect.any(HTMLDivElement),
  );
});

it("rewrites single-branch sequence par blocks for Mermaid compatibility", async () => {
  render(
    <MermaidBlocks
      html={'<pre class="mermaid" data-mermaid-source="sequenceDiagram\n  A->>B: before\n  par parallel-only\n    A->>B: inside\n  end\n  B-->>A: after"></pre>'}
      path="README.md"
    />,
  );

  await vi.waitFor(() => expect(mockMermaidRender).toHaveBeenCalled());
  expect(mockMermaidRender).toHaveBeenCalledWith(
    expect.stringMatching(/^mermaid-.*-0$/),
    "sequenceDiagram\n  A->>B: before\n    A->>B: inside\n  B-->>A: after",
    expect.any(HTMLDivElement),
  );
});

it("rewrites repeated single-branch par blocks from real sequence docs", async () => {
  render(
    <MermaidBlocks
      html={'<pre class="mermaid" data-mermaid-source="sequenceDiagram\n  Loop->>Bot: run()\n  par 对候选并行估算\n    Bot->>Lens: estimateLiquidation(proxy, isDirectRedemption)\n  end\n  Lens-->>Bot: amounts 或 error\n  par 并行等待已发送交易\n    Bot->>RPC: waitForTransactionReceipt(hash, timeout)\n  end\n  RPC-->>Bot: success / reverted / rejected"></pre>'}
      path="README.md"
    />,
  );

  await vi.waitFor(() => expect(mockMermaidRender).toHaveBeenCalled());
  expect(mockMermaidRender).toHaveBeenCalledWith(
    expect.stringMatching(/^mermaid-.*-0$/),
    "sequenceDiagram\n  Loop->>Bot: run()\n    Bot->>Lens: estimateLiquidation(proxy, isDirectRedemption)\n  Lens-->>Bot: amounts 或 error\n    Bot->>RPC: waitForTransactionReceipt(hash, timeout)\n  RPC-->>Bot: success / reverted / rejected",
    expect.any(HTMLDivElement),
  );
});

it("rewrites sequence participant aliases that collide with Mermaid keywords", async () => {
  render(
    <MermaidBlocks
      html={'<pre class="mermaid" data-mermaid-source="sequenceDiagram\n  participant Loop as Polling loop\n  participant Bot\n  Loop-&gt;&gt;Bot: run()\n  loop poll\n    Bot-&gt;&gt;Bot: work\n  end\n  Bot--&gt;&gt;Loop: done\n  Loop-&gt;&gt;Bot: next"></pre>'}
      path="README.md"
    />,
  );

  await vi.waitFor(() => expect(mockMermaidRender).toHaveBeenCalled());
  expect(mockMermaidRender).toHaveBeenCalledWith(
    expect.stringMatching(/^mermaid-.*-0$/),
    "sequenceDiagram\n  participant Loop_participant as Polling loop\n  participant Bot\n  Loop_participant->>Bot: run()\n  loop poll\n    Bot->>Bot: work\n  end\n  Bot-->>Loop_participant: done\n  Loop_participant->>Bot: next",
    expect.any(HTMLDivElement),
  );
});

it("shows an unavailable project without exposing its filesystem path", () => {
  render(<ProjectUnavailable title="Unavailable" />);
  expect(screen.getByRole("heading", { name: "Unavailable is unavailable" })).toBeVisible();
  expect(screen.getByText(/directory exists and is readable/i)).toBeVisible();
  expect(document.body).not.toHaveTextContent("/private/");
});

it("renders an error boundary fragment without nesting a document", () => {
  const view = ErrorView({ error: new Error("private stack"), reset: () => undefined });
  expect(view.type).toBe("main");
  const { container } = render(<ErrorView error={new Error("private stack")} reset={() => undefined} />);
  expect(screen.getByRole("heading", { name: "This document could not be displayed" })).toBeVisible();
  expect(container.querySelector("html, body")).toBeNull();
  expect(container).not.toHaveTextContent("private stack");
});
