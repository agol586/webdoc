import { describe, expect, it } from "vitest";

import { nodeDestination, selectActivePath } from "../../src/lib/page-selection";

describe("reader active path selection", () => {
  it("keeps a deep-linked image active", () => {
    expect(selectActivePath("images/logo.png", "")).toBe("images/logo.png");
  });

  it("uses the Markdown document path when no image is selected", () => {
    expect(selectActivePath(null, "guide/start.md")).toBe("guide/start.md");
  });

  it("returns undefined for an empty project", () => {
    expect(selectActivePath(null, "")).toBeUndefined();
  });
});

describe("tree node destinations", () => {
  it("sends an attachment node to the asset endpoint", () => {
    expect(nodeDestination("alpha", { kind: "attachment", name: "manual.pdf", path: "files/manual.pdf", size: 1 })).toEqual({ kind: "redirect", href: "/api/assets/alpha/files/manual.pdf" });
  });

  it("treats a dotted directory as a directory, not an attachment", () => {
    expect(nodeDestination("alpha", { kind: "directory", name: "v1.0", path: "v1.0", children: [{ kind: "markdown", name: "index.md", path: "v1.0/index.md", size: 1 }] })).toEqual({ kind: "redirect", href: "/p/alpha/v1.0/index.md" });
  });
});
