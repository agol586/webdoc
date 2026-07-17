import { relative, resolve, sep } from "node:path";

import chokidar from "chokidar";

import { loadConfig, type WebDocConfig } from "../config/load";
import type { ServerContext } from "../server/context";
import type { ChangeHub } from "./change-hub";

export type WatchHandle = {
  on(event: string, handler: (...args: unknown[]) => void): WatchHandle;
  add(paths: string | readonly string[]): unknown;
  unwatch(paths: string | readonly string[]): unknown;
  close(): Promise<unknown>;
};

type WatchFactory = (paths: string[]) => WatchHandle;
type ConfigLoader = (path: string) => Promise<WebDocConfig>;

export class ProjectWatcher {
  private handle?: WatchHandle;
  private roots = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private rescanning = false;
  private closed = false;
  private generation = 0;
  private readonly inFlight = new Set<Promise<unknown>>();
  private recoveryAbort?: AbortController;
  private reloadVersion = 0;
  private reloadLoop?: Promise<void>;

  constructor(
    private readonly context: ServerContext,
    private readonly hub: ChangeHub,
    private readonly configPath: string,
    private readonly watch: WatchFactory = (paths) => chokidar.watch(paths, { ignoreInitial: true }) as WatchHandle,
    private readonly load: ConfigLoader = loadConfig,
  ) {}

  async start(config: WebDocConfig): Promise<void> {
    if (this.closed) throw new Error("Cannot start a closed project watcher");
    if (this.handle) return;
    this.roots = new Map(config.projects.map((project) => [project.id, project.root]));
    this.handle = this.watch([this.configPath, ...this.roots.values()]);
    for (const event of ["add", "change", "unlink", "addDir", "unlinkDir"]) {
      this.handle.on(event, (path) => this.onChange(String(path)));
    }
    this.handle.on("error", () => this.requestRecovery());
    this.handle.on("raw", (event) => {
      if (String(event).toLowerCase().includes("overflow")) this.requestRecovery();
    });
  }

  private onChange(changedPath: string): void {
    if (this.closed) return;
    if (resolve(changedPath) === resolve(this.configPath)) {
      this.debounce("config", () => { void this.reloadConfig(); });
      return;
    }
    for (const [projectId, root] of this.roots) {
      const path = relative(root, changedPath);
      if (path !== ".." && !path.startsWith(`..${sep}`)) {
        const portablePath = path.split(sep).join("/");
        this.debounce(`${projectId}:${portablePath}`, () => {
          if (this.roots.get(projectId) !== root) return;
          this.hub.publish(portablePath ? { kind: "project", projectId, path: portablePath } : { kind: "project", projectId });
        });
        return;
      }
    }
  }

  private debounce(key: string, action: () => void): void {
    if (this.closed) return;
    const current = this.timers.get(key);
    if (current) clearTimeout(current);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      action();
    }, 100));
  }

  reloadConfig(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.reloadVersion++;
    if (!this.reloadLoop) {
      const loop = this.runReloads();
      this.reloadLoop = loop;
      this.track(loop);
      void loop.finally(() => { if (this.reloadLoop === loop) this.reloadLoop = undefined; });
    }
    return this.reloadLoop;
  }

  private async runReloads(): Promise<void> {
    let completed = 0;
    const token = this.generation;
    while (this.isCurrent(token) && completed < this.reloadVersion) {
      const version = this.reloadVersion;
      try {
        const next = await this.load(this.configPath);
        if (!this.isCurrent(token)) return;
        if (version !== this.reloadVersion) { completed = version; continue; }
        const priorRoots = new Set(this.roots.values());
        const nextRoots = new Set(next.projects.map((project) => project.root));
        const removed = [...priorRoots].filter((root) => !nextRoots.has(root));
        const added = [...nextRoots].filter((root) => !priorRoots.has(root));
        if (removed.length) await this.handle?.unwatch(removed.length === 1 ? removed[0] : removed);
        if (!this.isCurrent(token)) return;
        if (version !== this.reloadVersion) { completed = version; continue; }
        if (added.length) this.handle?.add(added.length === 1 ? added[0] : added);
        const nextMappings = new Map(next.projects.map((project) => [project.id, project.root]));
        for (const [key, timer] of this.timers) {
          if (key === "config") continue;
          const projectId = key.slice(0, key.indexOf(":"));
          if (this.roots.get(projectId) !== nextMappings.get(projectId)) {
            clearTimeout(timer);
            this.timers.delete(key);
          }
        }
        this.roots = nextMappings;
        this.context.config = next;
        this.hub.publish({ kind: "config" });
        this.hub.publish({ kind: "status", status: "connected" });
      } catch {
        if (!this.isCurrent(token)) return;
        if (version === this.reloadVersion) this.hub.publish({ kind: "status", status: "degraded" });
      }
      completed = version;
    }
  }

  private async recover(): Promise<void> {
    if (this.rescanning || this.closed) return;
    this.rescanning = true;
    const token = this.generation;
    const abort = new AbortController();
    this.recoveryAbort = abort;
    const deadline = setTimeout(() => abort.abort(new DOMException("Recovery deadline exceeded", "TimeoutError")), 30_000);
    this.hub.publish({ kind: "status", status: "degraded" });
    try {
      if (this.context.config.projects.length > 100) throw new Error("Recovery project budget exceeded");
      for (const project of this.context.config.projects) {
        await this.context.repository.getTree(project, { signal: abort.signal, maxEntries: 100_000 });
        if (!this.isCurrent(token)) return;
      }
      this.hub.publish({ kind: "status", status: "connected" });
      for (const project of this.context.config.projects) this.hub.publish({ kind: "project", projectId: project.id });
    } catch {
      // Stay degraded; another watcher error can initiate a later bounded rescan.
    } finally {
      clearTimeout(deadline);
      if (this.recoveryAbort === abort) this.recoveryAbort = undefined;
      this.rescanning = false;
    }
  }

  private requestRecovery(): void {
    if (this.rescanning || this.closed) return;
    const recovery = this.recover();
    this.track(recovery);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.recoveryAbort?.abort(new DOMException("Watcher closed", "AbortError"));
    const handle = this.handle;
    this.handle = undefined;
    await handle?.close();
    await Promise.allSettled([...this.inFlight]);
  }

  private isCurrent(token: number): boolean {
    return !this.closed && this.generation === token;
  }

  private track(promise: Promise<unknown>): void {
    this.inFlight.add(promise);
    void promise.finally(() => this.inFlight.delete(promise));
  }
}
