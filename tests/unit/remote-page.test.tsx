import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchRemoteMarkdown, mockGetServerContext, mockRedirect } = vi.hoisted(() => ({
  mockFetchRemoteMarkdown: vi.fn(),
  mockGetServerContext: vi.fn(),
  mockRedirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("../../src/server/context", () => ({ getServerContext: mockGetServerContext }));
vi.mock("../../src/remote/fetch-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/remote/fetch-markdown")>();
  return { ...actual, fetchRemoteMarkdown: mockFetchRemoteMarkdown };
});
vi.mock("../../src/components/document-view", () => ({
  DocumentView: ({ html, title }: { html: string; title?: string }) => (
    <article aria-label={title} dangerouslySetInnerHTML={{ __html: html }} />
  ),
}));

import Home from "../../src/app/page";
import { RemoteMarkdownError } from "../../src/remote/fetch-markdown";

describe("remote Markdown root page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerContext.mockResolvedValue({
      config: {
        limits: { markdownBytes: 1024, assetBytes: 2048 },
        projects: [{ id: "alpha", title: "Alpha", root: "/tmp/alpha" }],
      },
      repository: {
        isAvailable: vi.fn().mockResolvedValue(true),
        getTree: vi.fn().mockResolvedValue([]),
        chooseHomepage: vi.fn().mockResolvedValue("README.md"),
      },
    });
  });

  afterEach(cleanup);

  it("preserves the existing local-project redirect without link", async () => {
    await expect(Home({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/p/alpha/README.md");
    expect(mockFetchRemoteMarkdown).not.toHaveBeenCalled();
  });

  it("fetches and renders a remote Markdown document", async () => {
    mockFetchRemoteMarkdown.mockResolvedValue({
      source: "# Remote title",
      finalUrl: "https://cdn.example.com/docs/readme.md",
    });

    render(await Home({
      searchParams: Promise.resolve({ link: "https://example.com/readme.md" }),
    }));

    expect(mockFetchRemoteMarkdown).toHaveBeenCalledWith(
      "https://example.com/readme.md",
      { maxBytes: 1024 },
    );
    expect(screen.getByRole("article", { name: "Remote title" })).toHaveTextContent("Remote title");
    expect(screen.getByRole("link", { name: /cdn\.example\.com/i })).toHaveAttribute(
      "href",
      "https://cdn.example.com/docs/readme.md",
    );
    expect(screen.getByRole("textbox", { name: "Remote Markdown URL" })).toHaveValue(
      "https://cdn.example.com/docs/readme.md",
    );
  });

  it("rejects repeated link parameters without fetching either target", async () => {
    render(await Home({
      searchParams: Promise.resolve({
        link: ["https://example.com/a.md", "https://example.com/b.md"],
      }),
    }));

    expect(mockFetchRemoteMarkdown).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/single link/i);
  });

  it("shows a safe non-reflective policy error", async () => {
    const attackerInput = "https://127.0.0.1/private.md";
    mockFetchRemoteMarkdown.mockRejectedValue(
      new RemoteMarkdownError("The remote document host is not public."),
    );

    render(await Home({
      searchParams: Promise.resolve({ link: attackerInput }),
    }));

    expect(screen.getByRole("alert")).toHaveTextContent(/not public/i);
    expect(screen.getByRole("alert")).not.toHaveTextContent(attackerInput);
    expect(screen.getByRole("textbox", { name: "Remote Markdown URL" })).toBeVisible();
  });

  it("normalizes attacker-controlled Markdown render failures", async () => {
    mockFetchRemoteMarkdown.mockResolvedValue({
      source: "[unsafe](javascript:alert(1))",
      finalUrl: "https://example.com/readme.md",
    });

    render(await Home({
      searchParams: Promise.resolve({ link: "https://example.com/readme.md" }),
    }));

    expect(screen.getByRole("alert")).toHaveTextContent(/unsafe or invalid/i);
    expect(screen.getByRole("alert")).not.toHaveTextContent("javascript");
  });
});
