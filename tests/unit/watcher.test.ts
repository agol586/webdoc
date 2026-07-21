import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeHub } from "../../src/live/change-hub";
import { ProjectWatcher, type WatchHandle } from "../../src/live/watcher";
import { DocumentRepository } from "../../src/repository/repository";
import type { ServerContext } from "../../src/server/context";
import type { DocShareConfig } from "../../src/config/load";

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
  fixture = await mkdtemp(join(tmpdir(), "docshare-watch-"));
  alphaRoot = join(fixture, "alpha");
  await mkdir(alphaRoot);
  configPath = join(fixture, "docshare.config.yaml");
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
    expect(repository.getTree).toHaveBeenNthCalledWith(1, context.config.projects[0], expect.objectContaining({ maxEntries: 100_000, signal: expect.any(AbortSignal) }));
  });

  it("stops recovery before scanning when the project budget is exceeded", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
    diagnostic.mockClear();
    const hub = { publish: vi.fn() } as unknown as ChangeHub;
    const repository = new DocumentRepository();
    vi.spyOn(repository, "getTree").mockResolvedValue([]);
    const projects = Array.from({ length: 101 }, (_, index) => ({ id: `p${index}`, title: `P${index}`, root: alphaRoot }));
    const context: ServerContext = { config: { server: { host: "127.0.0.1", port: 3000 }, limits: { markdownBytes: 1, assetBytes: 1 }, projects }, repository };
    const watcher = new ProjectWatcher(context, hub, configPath, () => fakeWatch());
    await watcher.start(context.config);
    emit("error", new Error("overflow"));
    await vi.waitFor(() => expect(hub.publish).toHaveBeenCalledWith({ kind: "status", status: "degraded" }));
    expect(repository.getTree).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith("DocShare watcher recovery failed", expect.objectContaining({ category: "Error", message: expect.stringMatching(/budget/i) }));
  });

  it("close aborts and awaits recovery without publishing afterward", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
    diagnostic.mockClear();
    const hub = { publish: vi.fn() } as unknown as ChangeHub;
    const repository = new DocumentRepository();
    vi.spyOn(repository, "getTree").mockImplementation(async (_project, options) => {
      await new Promise<void>((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true }));
      return [];
    });
    const context: ServerContext = { config: { server: { host: "127.0.0.1", port: 3000 }, limits: { markdownBytes: 1, assetBytes: 1 }, projects: [{ id: "alpha", title: "Alpha", root: alphaRoot }] }, repository };
    const watcher = new ProjectWatcher(context, hub, configPath, () => fakeWatch());
    await watcher.start(context.config);
    emit("error", new Error("overflow"));
    await vi.waitFor(() => expect(repository.getTree).toHaveBeenCalled());
    (hub.publish as ReturnType<typeof vi.fn>).mockClear();
    await watcher.close();
    expect(hub.publish).not.toHaveBeenCalled();
    expect(diagnostic).not.toHaveBeenCalledWith("DocShare watcher recovery failed", expect.anything());
  });

  it("serializes overlapping reloads so the latest disk generation wins", async () => {
    const hub = { publish: vi.fn() } as unknown as ChangeHub;
    const context: ServerContext = { config: { server: { host: "127.0.0.1", port: 3000 }, limits: { markdownBytes: 1, assetBytes: 1 }, projects: [{ id: "alpha", title: "Alpha", root: alphaRoot }] }, repository: new DocumentRepository() };
    const releases: Array<(config: DocShareConfig) => void> = [];
    const loader = vi.fn(() => new Promise<DocShareConfig>((resolve) => releases.push(resolve)));
    const watcher = new ProjectWatcher(context, hub, configPath, () => fakeWatch(), loader);
    await watcher.start(context.config);
    const first = watcher.reloadConfig();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const second = watcher.reloadConfig();
    releases.shift()!({ ...context.config, projects: [{ id: "stale", title: "Stale", root: alphaRoot }] });
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()!({ ...context.config, projects: [{ id: "latest", title: "Latest", root: alphaRoot }] });
    await Promise.all([first, second]);
    expect(context.config.projects[0].id).toBe("latest");
  });

  it("close during reload prevents context writes and publication", async () => {
    const hub = { publish: vi.fn() } as unknown as ChangeHub;
    const original = { server: { host: "127.0.0.1", port: 3000 }, limits: { markdownBytes: 1, assetBytes: 1 }, projects: [{ id: "alpha", title: "Alpha", root: alphaRoot }] };
    const context: ServerContext = { config: original, repository: new DocumentRepository() };
    let release!: (config: DocShareConfig) => void;
    const loader = () => new Promise<DocShareConfig>((resolve) => { release = resolve; });
    const watcher = new ProjectWatcher(context, hub, configPath, () => fakeWatch(), loader);
    await watcher.start(context.config);
    const reload = watcher.reloadConfig();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const closing = watcher.close();
    release({ ...original, projects: [{ id: "stale", title: "Stale", root: alphaRoot }] });
    await Promise.all([reload, closing]);
    expect(context.config).toBe(original);
    expect(hub.publish).not.toHaveBeenCalled();
  });

  it("compensates actual watched roots when A to B reconcile becomes stale and returns to A", async () => {
    const betaRoot = join(fixture, "beta");
    await mkdir(betaRoot);
    const actual = new Set([alphaRoot]);
    let releaseUnwatch!: () => void;
    const handle = fakeWatch();
    handle.unwatch = vi.fn(async (paths: string | readonly string[]) => {
      await new Promise<void>((resolve) => { releaseUnwatch = resolve; });
      for (const path of typeof paths === "string" ? [paths] : paths) actual.delete(path);
    });
    handle.add = vi.fn((paths: string | readonly string[]) => {
      for (const path of typeof paths === "string" ? [paths] : paths) actual.add(path);
    });
    const original = { server: { host: "127.0.0.1", port: 3000 }, limits: { markdownBytes: 1, assetBytes: 1 }, projects: [{ id: "alpha", title: "Alpha", root: alphaRoot }] };
    const context: ServerContext = { config: original, repository: new DocumentRepository() };
    const configs = [
      { ...original, projects: [{ id: "beta", title: "Beta", root: betaRoot }] },
      original,
    ];
    const watcher = new ProjectWatcher(context, { publish: vi.fn() } as unknown as ChangeHub, configPath, () => handle, async () => configs.shift()!);
    await watcher.start(original);
    const first = watcher.reloadConfig();
    await vi.waitFor(() => expect(releaseUnwatch).toBeTypeOf("function"));
    const second = watcher.reloadConfig();
    releaseUnwatch();
    await Promise.all([first, second]);
    expect(actual).toEqual(new Set([alphaRoot]));
    expect(handle.add).toHaveBeenCalledWith(alphaRoot);
  });

  it("invalid reload aborts an older recovery and it never restores connected health", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hub = { publish: vi.fn() } as unknown as ChangeHub;
    const repository = new DocumentRepository();
    let recoverySignal: AbortSignal | undefined;
    vi.spyOn(repository, "getTree").mockImplementation(async (_project, options) => {
      recoverySignal = options?.signal;
      await new Promise<void>((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true }));
      return [];
    });
    const context: ServerContext = { config: { server: { host: "127.0.0.1", port: 3000 }, limits: { markdownBytes: 1, assetBytes: 1 }, projects: [{ id: "alpha", title: "Alpha", root: alphaRoot }] }, repository };
    const watcher = new ProjectWatcher(context, hub, configPath, () => fakeWatch(), async () => { throw new Error("invalid"); });
    await watcher.start(context.config);
    emit("error", new Error("overflow"));
    await vi.waitFor(() => expect(repository.getTree).toHaveBeenCalled());
    await watcher.reloadConfig();
    expect(recoverySignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(hub.publish).toHaveBeenCalledWith({ kind: "status", status: "degraded" }));
    expect(hub.publish).not.toHaveBeenCalledWith({ kind: "status", status: "connected" });
    expect(diagnostic).toHaveBeenCalledWith("DocShare config reload rejected", expect.objectContaining({ category: "Error", message: "invalid" }));
    expect(diagnostic).not.toHaveBeenCalledWith("DocShare watcher recovery failed", expect.anything());
  });
});
