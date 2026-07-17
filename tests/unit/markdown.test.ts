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

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java%73cript:alert(1)",
    "data:text/html,boom",
    "vbscript:msgbox(1)",
  ])("rejects a dangerous or obfuscated link scheme: %s", async (url) => {
    await expect(
      renderMarkdown({
        projectId: "alpha",
        documentPath: "guide/a.md",
        source: `[unsafe](${url})`,
      }),
    ).rejects.toThrow(/scheme|unsafe/i);
  });

  it("allows only HTTP(S) schemes for external images", async () => {
    await expect(
      renderMarkdown({
        projectId: "alpha",
        documentPath: "guide/a.md",
        source: "![unsafe](mailto:test@example.com)",
      }),
    ).rejects.toThrow(/scheme|unsafe/i);

    const { html } = await renderMarkdown({
      projectId: "alpha",
      documentPath: "guide/a.md",
      source: "![safe](https://example.com/image.png)",
    });
    expect(html).toContain('src="https://example.com/image.png"');
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

  it.each([
    ["%2e%2e/b.md", "/p/alpha/b.md"],
    ["%252e%252e/b.md", "/p/alpha/b.md"],
    ["sub%2fdoc.md", "/p/alpha/guide/sub/doc.md"],
    ["sub%252fdoc.md", "/p/alpha/guide/sub/doc.md"],
    ["what%3fname.md", "/p/alpha/guide/what%3Fname.md"],
    ["hash%23name.md", "/p/alpha/guide/hash%23name.md"],
  ])("canonically rewrites encoded relative path %s", async (url, expected) => {
    const { html } = await renderMarkdown({
      projectId: "alpha",
      documentPath: "guide/a.md",
      source: `[encoded](${url})`,
    });

    expect(html).toContain(`href="${expected}"`);
  });

  it("resolves a query-only link against the current document and preserves hash-only links", async () => {
    const { html } = await renderMarkdown({
      projectId: "alpha",
      documentPath: "guide/a.md",
      source: "[query](?x=1) [section](#details)",
    });

    expect(html).toContain('href="/p/alpha/guide/a.md?x=1"');
    expect(html).toContain('href="#details"');
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

  it("recognizes Mermaid fence languages case-insensitively", async () => {
    const { html } = await renderMarkdown({
      projectId: "alpha",
      documentPath: "guide/a.md",
      source: "```MerMaid\ngraph TD\nA --> B\n```",
    });

    expect(html).toContain('class="mermaid"');
    expect(html).toContain('data-mermaid-source="graph TD');
    expect(html).not.toContain('class="shiki');
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

  it("includes inline code, emphasis, link text, and image alt in the title", async () => {
    const result = await renderMarkdown({
      projectId: "alpha",
      documentPath: "guide/a.md",
      source: "# API `code` *emphasis* [link](./b.md) ![diagram](./d.png)",
    });

    expect(result.title).toBe("API code emphasis link diagram");
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
