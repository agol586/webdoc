import { describe, expect, it } from "vitest";

import { renderMarkdown } from "../../src/markdown/render";

describe("renderMarkdown", () => {
  it("renders GFM while dropping raw HTML", async () => {
    const result = await renderMarkdown({
      projectId: "alpha",
      documentPath: "guide/a.md",
      source: "|A|B|\n|-|-|\n|1|2|\n<script>alert(1)</script>",
    });

    expect(result.html).toContain("<table>");
    expect(result.html).not.toContain("<script");
  });

  it("rewrites relative docs and images but preserves external links safely", async () => {
    const { html } = await renderMarkdown({
      projectId: "alpha",
      documentPath: "guide/a.md",
      source: "[B](../b.md) ![P](./p.png) [X](https://example.com)",
    });

    expect(html).toContain('href="/p/alpha/b.md"');
    expect(html).toContain('src="/api/assets/alpha/guide/p.png"');
    expect(html).toContain(
      'href="https://example.com" target="_blank" rel="noopener noreferrer"',
    );
  });

  it("rejects a relative URL that escapes the document root", async () => {
    await expect(
      renderMarkdown({
        projectId: "alpha",
        documentPath: "guide/a.md",
        source: "[outside](../../outside.md)",
      }),
    ).rejects.toThrow(/outside|escape/i);
  });

  it("marks Mermaid blocks without executing or exposing diagram content as HTML", async () => {
    const { html } = await renderMarkdown({
      projectId: "alpha",
      documentPath: "guide/a.md",
      source: "```mermaid\ngraph TD\nA[<script>alert(1)</script>] --> B\n```",
    });

    expect(html).toContain('class="mermaid"');
    expect(html).toContain("data-mermaid-source=");
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("pre.mermaid")?.getAttribute("data-mermaid-source")).toContain(
      "<script>alert(1)</script>",
    );
  });

  it("returns the first heading as the document title", async () => {
    const result = await renderMarkdown({
      projectId: "alpha",
      documentPath: "guide/a.md",
      source: "# First title\n\n## Second title",
    });

    expect(result.title).toBe("First title");
    expect(result.html).toContain('id="first-title"');
  });

  it("highlights non-Mermaid fenced code with Shiki", async () => {
    const { html } = await renderMarkdown({
      projectId: "alpha",
      documentPath: "guide/a.md",
      source: "```js\nconst answer = 42\n```",
    });

    expect(html).toContain('class="shiki github-dark"');
    expect(html).toContain('style="color:#F97583"');
  }, 20_000);
});
