import { createServer } from "node:net";

import { describe, expect, it, vi } from "vitest";

import {
  fetchRemoteMarkdown,
  requestPinnedHttps,
  type RemoteFetchDependencies,
  type RemoteResponse,
} from "../../src/remote/fetch-markdown";

function response(
  body: string,
  options: Partial<Omit<RemoteResponse, "body">> = {},
): RemoteResponse {
  return {
    statusCode: options.statusCode ?? 200,
    headers: options.headers ?? { "content-type": "text/markdown; charset=utf-8" },
    body: (async function* () {
      yield Buffer.from(body);
    })(),
  };
}

function dependencies(
  overrides: Partial<RemoteFetchDependencies> = {},
): RemoteFetchDependencies {
  return {
    resolve: overrides.resolve ?? (async () => [{ address: "93.184.216.34", family: 4 }]),
    request: overrides.request ?? (async () => response("# Remote")),
  };
}

describe("fetchRemoteMarkdown", () => {
  it("uses a Node-compatible pinned lookup in the production HTTPS adapter", async () => {
    let connected = false;
    const server = createServer((socket) => {
      connected = true;
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const bound = server.address();
    if (!bound || typeof bound === "string") throw new Error("Expected a TCP test address");

    let failure: unknown;
    try {
      await requestPinnedHttps({
        url: new URL(`https://example.com:${bound.port}/readme.md`),
        address: "127.0.0.1",
        family: 4,
        signal: new AbortController().signal,
      });
    } catch (error) {
      failure = error;
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }

    expect(failure).toBeInstanceOf(Error);
    expect(connected).toBe(true);
    expect((failure as NodeJS.ErrnoException).code).not.toBe("ERR_INVALID_IP_ADDRESS");
  });

  it.each([
    "http://example.com/readme.md",
    "file:///etc/passwd",
    "https://user:secret@example.com/readme.md",
    "https://example.com/" + "a".repeat(2048),
  ])("rejects unsafe URL %s", async (url) => {
    await expect(fetchRemoteMarkdown(url, { maxBytes: 1024 }, dependencies())).rejects.toThrow();
  });

  it("rejects a hostname when any DNS answer is non-public", async () => {
    const request = vi.fn<RemoteFetchDependencies["request"]>();
    const deps = dependencies({
      resolve: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
      request,
    });

    await expect(
      fetchRemoteMarkdown("https://example.com/readme.md", { maxBytes: 1024 }, deps),
    ).rejects.toThrow(/public/i);
    expect(request).not.toHaveBeenCalled();
  });

  it("pins the validated address and returns UTF-8 Markdown", async () => {
    const request = vi.fn<RemoteFetchDependencies["request"]>(
      async ({ address, family }) => {
        expect(address).toBe("93.184.216.34");
        expect(family).toBe(4);
        return response("# 文档");
      },
    );

    const result = await fetchRemoteMarkdown(
      "https://example.com/readme.md",
      { maxBytes: 1024 },
      dependencies({ request }),
    );

    expect(result).toEqual({
      source: "# 文档",
      finalUrl: "https://example.com/readme.md",
    });
  });

  it("normalizes bracketed public IPv6 literals before resolution", async () => {
    const resolve = vi.fn<RemoteFetchDependencies["resolve"]>(
      async () => [{ address: "2606:4700:4700::1111", family: 6 }],
    );

    await fetchRemoteMarkdown(
      "https://[2606:4700:4700::1111]/readme.md",
      { maxBytes: 1024 },
      dependencies({ resolve }),
    );

    expect(resolve).toHaveBeenCalledWith("2606:4700:4700::1111");
  });

  it("resolves and revalidates every redirect", async () => {
    const resolved: string[] = [];
    const requested: string[] = [];
    const result = await fetchRemoteMarkdown(
      "https://example.com/start.md",
      { maxBytes: 1024 },
      dependencies({
        resolve: async (hostname) => {
          resolved.push(hostname);
          return [{
            address: hostname === "cdn.example.net" ? "1.1.1.1" : "93.184.216.34",
            family: 4,
          }];
        },
        request: async ({ url }) => {
          requested.push(url.href);
          return requested.length === 1
            ? response("", { statusCode: 302, headers: { location: "https://cdn.example.net/docs/final.md" } })
            : response("# Final");
        },
      }),
    );

    expect(resolved).toEqual(["example.com", "cdn.example.net"]);
    expect(requested).toEqual([
      "https://example.com/start.md",
      "https://cdn.example.net/docs/final.md",
    ]);
    expect(result.finalUrl).toBe("https://cdn.example.net/docs/final.md");
  });

  it("rejects redirects beyond the configured hop budget", async () => {
    await expect(fetchRemoteMarkdown(
      "https://example.com/0.md",
      { maxBytes: 1024 },
      dependencies({
        request: async ({ url }) => response("", {
          statusCode: 302,
          headers: { location: `https://example.com/${Number(url.pathname.slice(1, -3)) + 1}.md` },
        }),
      }),
    )).rejects.toThrow(/redirect/i);
  });

  it("rejects non-success statuses and non-Markdown content types", async () => {
    await expect(fetchRemoteMarkdown(
      "https://example.com/missing.md",
      { maxBytes: 1024 },
      dependencies({ request: async () => response("", { statusCode: 404 }) }),
    )).rejects.toThrow(/status/i);

    await expect(fetchRemoteMarkdown(
      "https://example.com/page",
      { maxBytes: 1024 },
      dependencies({
        request: async () => response("<html>", {
          headers: { "content-type": "text/html" },
        }),
      }),
    )).rejects.toThrow(/content type/i);

    await expect(fetchRemoteMarkdown(
      "https://example.com/binary",
      { maxBytes: 1024 },
      dependencies({
        request: async () => response("binary", {
          headers: { "content-type": "application/octet-stream" },
        }),
      }),
    )).rejects.toThrow(/content type/i);
  });

  it("enforces declared and streamed response byte limits", async () => {
    await expect(fetchRemoteMarkdown(
      "https://example.com/large.md",
      { maxBytes: 4 },
      dependencies({
        request: async () => response("tiny", {
          headers: { "content-type": "text/plain", "content-length": "5" },
        }),
      }),
    )).rejects.toThrow(/large/i);

    await expect(fetchRemoteMarkdown(
      "https://example.com/chunked.md",
      { maxBytes: 4 },
      dependencies({
        request: async () => ({
          statusCode: 200,
          headers: { "content-type": "text/plain" },
          body: (async function* () {
            yield Buffer.from("123");
            yield Buffer.from("45");
          })(),
        }),
      }),
    )).rejects.toThrow(/large/i);
  });

  it("applies the request deadline while DNS resolution is pending", async () => {
    await expect(fetchRemoteMarkdown(
      "https://example.com/readme.md",
      { maxBytes: 1024, timeoutMs: 5 },
      dependencies({
        resolve: async () => new Promise(() => undefined),
      }),
    )).rejects.toThrow(/timed out/i);
  });
});
