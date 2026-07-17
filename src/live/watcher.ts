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

export class ProjectWatcher {
  private handle?: WatchHandle;
  private roots = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private rescanning = false;

  constructor(
    private readonly context: ServerContext,
    private readonly hub: ChangeHub,
    private readonly configPath: string,
    private readonly watch: WatchFactory = (paths) => chokidar.watch(paths, { ignoreInitial: true }) as WatchHandle,
  ) {}

  async start(config: WebDocConfig): Promise<void> {
    if (this.handle) return;
    this.roots = new Map(config.projects.map((project) => [project.id, project.root]));
    this.handle = this.watch([this.configPath, ...this.roots.values()]);
    for (const event of ["add", "change", "unlink", "addDir", "unlinkDir"]) {
      this.handle.on(event, (path) => this.onChange(String(path)));
    }
    this.handle.on("error", () => { void this.recover(); });
    this.handle.on("raw", (event) => {
      if (String(event).toLowerCase().includes("overflow")) void this.recover();
    });
  }

  private onChange(changedPath: string): void {
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
    const current = this.timers.get(key);
    if (current) clearTimeout(current);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      action();
    }, 100));
  }

  async reloadConfig(): Promise<void> {
    try {
      const next = await loadConfig(this.configPath);
      const priorRoots = new Set(this.roots.values());
      const nextRoots = new Set(next.projects.map((project) => project.root));
      const removed = [...priorRoots].filter((root) => !nextRoots.has(root));
      const added = [...nextRoots].filter((root) => !priorRoots.has(root));
      if (removed.length) await this.handle?.unwatch(removed.length === 1 ? removed[0] : removed);
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
      this.hub.publish({ kind: "status", status: "degraded" });
    }
  }

  private async recover(): Promise<void> {
    if (this.rescanning) return;
    this.rescanning = true;
    this.hub.publish({ kind: "status", status: "degraded" });
    try {
      for (const project of this.context.config.projects) await this.context.repository.getTree(project);
      this.hub.publish({ kind: "status", status: "connected" });
      for (const project of this.context.config.projects) this.hub.publish({ kind: "project", projectId: project.id });
    } catch {
      // Stay degraded; another watcher error can initiate a later bounded rescan.
    } finally {
      this.rescanning = false;
    }
  }

  async close(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    const handle = this.handle;
    this.handle = undefined;
    await handle?.close();
  }
}
