import { describe, expect, it } from "vitest";

import { selectActivePath } from "../../src/lib/page-selection";

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
