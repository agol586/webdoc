import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const close = vi.fn(async () => undefined);
const start = vi.fn(async () => undefined);
let fixture: string;

vi.mock("../../src/live/watcher", () => ({
  ProjectWatcher: class {
    start = start;
    close = close;
  },
}));

beforeEach(async () => {
  vi.resetModules();
  close.mockClear();
  start.mockClear();
  delete (globalThis as typeof globalThis & { __webdocServerHolder?: unknown }).__webdocServerHolder;
  fixture = await mkdtemp(join(tmpdir(), "webdoc-context-"));
});

afterEach(async () => {
  delete process.env.WEBDOC_CONFIG;
  delete (globalThis as typeof globalThis & { __webdocServerHolder?: unknown }).__webdocServerHolder;
  await rm(fixture, { recursive: true, force: true });
});

async function config(name: string, id: string): Promise<string> {
  const directory = join(fixture, name);
  await mkdir(directory);
  const path = join(fixture, `${name}.yaml`);
  await writeFile(path, `projects:\n  - id: ${id}\n    title: ${id}\n    path: ./${name}\n`);
  return path;
}

it("shares context across HMR reloads and safely replaces runtime when config path changes", async () => {
  const alpha = await config("alpha", "alpha");
  process.env.WEBDOC_CONFIG = alpha;
  const firstModule = await import("../../src/server/context");
  const firstContext = await firstModule.getServerContext();
  expect((await firstModule.getLiveRuntime()).context).toBe(firstContext);

  vi.resetModules();
  const reloadedModule = await import("../../src/server/context");
  expect(await reloadedModule.getServerContext()).toBe(firstContext);
  expect((await reloadedModule.getLiveRuntime()).context).toBe(firstContext);
  expect(start).toHaveBeenCalledTimes(1);

  process.env.WEBDOC_CONFIG = await config("beta", "beta");
  const betaContext = await reloadedModule.getServerContext();
  const betaRuntime = await reloadedModule.getLiveRuntime();
  expect(betaContext).not.toBe(firstContext);
  expect(betaRuntime.context).toBe(betaContext);
  expect(close).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledTimes(2);
});
