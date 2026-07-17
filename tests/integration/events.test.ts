import { describe, expect, it } from "vitest";

import { ChangeHub } from "../../src/live/change-hub";

describe("change events", () => {
  it("delivers events and removes an aborted subscriber", async () => {
    const hub = new ChangeHub();
    const abort = new AbortController();
    const iterator = hub.subscribe(abort.signal)[Symbol.asyncIterator]();
    hub.publish({ kind: "project", projectId: "alpha", path: "guide.md" });
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { kind: "project", projectId: "alpha", path: "guide.md" } });
    abort.abort();
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(hub.subscriberCount).toBe(0);
  });

  it("returns SSE headers, an initial connection event, and abort cleanup", async () => {
    const { GET } = await import("../../src/app/api/events/route");
    const abort = new AbortController();
    const response = await GET(new Request("http://localhost/api/events", { signal: abort.signal }));
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('"status":"connected"');
    abort.abort();
    await expect(reader.read()).resolves.toMatchObject({ done: true });
  });
});
