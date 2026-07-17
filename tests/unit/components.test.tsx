import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { FileTree } from "../../src/components/file-tree";
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
});

it("shows Mermaid source when rendering fails", async () => {
  mockMermaidRender.mockRejectedValue(new Error("bad diagram"));
  render(<MermaidBlocks html={'<pre class="mermaid" data-mermaid-source="broken"></pre>'} path="README.md" />);
  expect(await screen.findByText(/diagram could not be rendered/i)).toBeVisible();
  expect(screen.getByText("broken")).toBeVisible();
});
