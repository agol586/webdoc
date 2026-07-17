import "@testing-library/jest-dom/vitest";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { FileTree } from "../../src/components/file-tree";
import { AppShell } from "../../src/components/app-shell";
import { ImageView } from "../../src/components/document-view";
import { MermaidBlocks } from "../../src/components/mermaid-blocks";
import { ProjectSwitcher } from "../../src/components/project-switcher";

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
  mockMermaidRender.mockResolvedValue({ svg: "<svg><title>diagram</title></svg>" });
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

it("shows Mermaid source when rendering fails", async () => {
  mockMermaidRender.mockRejectedValue(new Error("bad diagram"));
  render(<MermaidBlocks html={'<pre class="mermaid" data-mermaid-source="broken"></pre>'} path="README.md" />);
  expect(await screen.findByText(/diagram could not be rendered/i)).toBeVisible();
  expect(screen.getByText("broken")).toBeVisible();
});
