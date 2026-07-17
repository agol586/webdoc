import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeHub } from "../../src/live/change-hub";
import { ProjectWatcher, type WatchHandle } from "../../src/live/watcher";
import { DocumentRepository } from "../../src/repository/repository";
import type { ServerContext } from "../../src/server/context";

let fixture: string;
let alphaRoot: string;
let configPath: string;
let handlers: Record<string, ((...args: unknown[]) => void)[]>;

function fakeWatch(): WatchHandle {
  handlers = {};
  return {
    on(event, handler) {
      (handlers[event] ??= []).push(handler);
      return this;
    },
    add: vi.fn(),
    unwatch: vi.fn(),
    close: vi.fn(async () => undefined),
  };
}

function emit(event: string, ...args: unknown[]) {
  for (const handler of handlers[event] ?? []) handler(...args);
}

beforeEach(async () => {
  vi.useFakeTimers();
  fixture = await mkdtemp(join(tmpdir(), "webdoc-watch-"));
  alphaRoot = join(fixture, "alpha");
  await mkdir(alphaRoot);
  configPath = join(fixture, "webdoc.config.yaml");
  await writeFile(configPath, "projects:\n  - id: alpha\n    title: Alpha\n    path: ./alpha\n");
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(fixture, { recursive: true, force: true });
});

describe("ProjectWatcher", () => {
  it("debounces a burst into one project-scoped relative-path event", async () => {
    const hub = { publish: vi.fn() } as unknown as ChangeHub;
    const context: ServerContext = {
      config: { server: { host: "127.0.0.1", port: 3000 }, limits: { markdownBytes: 1, assetBytes: 1 }, projects: [{ id: "alpha", title: "Alpha", root: alphaRoot }] },
      repository: new DocumentRepository(),
    };
    const watcher = new ProjectWatcher(context, hub, configPath, () => fakeWatch());
    await watcher.start(context.config);
    emit("change", join(alphaRoot, "guide.md"));
    emit("change", join(alphaRoot, "guide.md"));
    await vi.advanceTimersByTimeAsync(100);
    expect(hub.publish).toHaveBeenCalledTimes(1);
    expect(hub.publish).toHaveBeenCalledWith({ kind: "project", projectId: "alpha", path: "guide.md" });
    expect(JSON.stringify((hub.publish as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(alphaRoot);
  });

  it("retains the last valid config when reload validation fails", async () => {
    const hub = { publish: vi.fn() } as unknown as ChangeHub;
    const previousConfig = { server: { host: "127.0.0.1", port: 3000 }, limits: { markdownBytes: 1, assetBytes: 1 }, projects: [{ id: "alpha", title: "Alpha", root: alphaRoot }] };
    const context: ServerContext = { config: previousConfig, repository: new DocumentRepository() };
    const watcher = new ProjectWatcher(context, hub, configPath, () => fakeWatch());
    await watcher.start(previousConfig);
    await writeFile(configPath, "projects: []\n");
    await watcher.reloadConfig();
    expect(context.config).toBe(previousConfig);
    expect(hub.publish).toHaveBeenCalledWith({ kind: "status", status: "degraded" });
  });

  it("atomically replaces valid config and unwatches removed project roots", async () => {
    const handle = fakeWatch();
    const hub = { publish: vi.fn() } as unknown as ChangeHub;
    const oldConfig = { server: { host: "127.0.0.1", port: 3000 }, limits: { markdownBytes: 1, assetBytes: 1 }, projects: [{ id: "alpha", title: "Alpha", root: alphaRoot }] };
    const context: ServerContext = { config: oldConfig, repository: new DocumentRepository() };
    const watcher = new ProjectWatcher(context, hub, configPath, () => handle);
    await watcher.start(oldConfig);
    const betaRoot = join(fixture, "beta");
    await mkdir(betaRoot);
    await writeFile(configPath, "projects:\n  - id: beta\n    title: Beta\n    path: ./beta\n");
    await watcher.reloadConfig();
    expect(context.config.projects.map((project) => project.id)).toEqual(["beta"]);
    expect(handle.unwatch).toHaveBeenCalledWith(alphaRoot);
    expect(handle.add).toHaveBeenCalledWith(betaRoot);
    expect(hub.publish).toHaveBeenCalledWith({ kind: "config" });
  });

  it("drops pending events when their project root is removed", async () => {
    const hub = { publish: vi.fn() } as unknown as ChangeHub;
    const context: ServerContext = { config: { server: { host: "127.0.0.1", port: 3000 }, limits: { markdownBytes: 1, assetBytes: 1 }, projects: [{ id: "alpha", title: "Alpha", root: alphaRoot }] }, repository: new DocumentRepository() };
    const watcher = new ProjectWatcher(context, hub, configPath, () => fakeWatch());
    await watcher.start(context.config);
    emit("change", join(alphaRoot, "stale.md"));
    const betaRoot = join(fixture, "beta");
    await mkdir(betaRoot);
    await writeFile(configPath, "projects:\n  - id: beta\n    title: Beta\n    path: ./beta\n");
    await watcher.reloadConfig();
    (hub.publish as ReturnType<typeof vi.fn>).mockClear();
    await vi.advanceTimersByTimeAsync(100);
    expect(hub.publish).not.toHaveBeenCalled();
  });

  it("publishes project refresh without a path for a root directory event", async () => {
    const hub = { publish: vi.fn() } as unknown as ChangeHub;
    const context: ServerContext = { config: { server: { host: "127.0.0.1", port: 3000 }, limits: { markdownBytes: 1, assetBytes: 1 }, projects: [{ id: "alpha", title: "Alpha", root: alphaRoot }] }, repository: new DocumentRepository() };
    const watcher = new ProjectWatcher(context, hub, configPath, () => fakeWatch());
    await watcher.start(context.config);
    emit("unlinkDir", alphaRoot);
    await vi.advanceTimersByTimeAsync(100);
    expect(hub.publish).toHaveBeenCalledWith({ kind: "project", projectId: "alpha" });
  });

  it("runs one recovery at a time and rescans projects sequentially", async () => {
    const hub = { publish: vi.fn() } as unknown as ChangeHub;
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const repository = new DocumentRepository();
    vi.spyOn(repository, "getTree").mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      return [];
    });
    const betaRoot = join(fixture, "beta");
    await mkdir(betaRoot);
    const context: ServerContext = { config: { server: { host: "127.0.0.1", port: 3000 }, limits: { markdownBytes: 1, assetBytes: 1 }, projects: [{ id: "alpha", title: "Alpha", root: alphaRoot }, { id: "beta", title: "Beta", root: betaRoot }] }, repository };
    const watcher = new ProjectWatcher(context, hub, configPath, () => fakeWatch());
    await watcher.start(context.config);
    emit("error", new Error("overflow"));
    emit("error", new Error("again"));
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()!();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()!();
    await vi.waitFor(() => expect(repository.getTree).toHaveBeenCalledTimes(2));
    expect(maximum).toBe(1);
  });
});
