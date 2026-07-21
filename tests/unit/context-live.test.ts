import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const close = vi.fn(async (): Promise<void> => undefined);
const start = vi.fn(async (): Promise<void> => undefined);
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
  delete (globalThis as typeof globalThis & { __docshareServerHolder?: unknown }).__docshareServerHolder;
  fixture = await mkdtemp(join(tmpdir(), "docshare-context-"));
});

afterEach(async () => {
  delete process.env.DOCSHARE_CONFIG;
  delete (globalThis as typeof globalThis & { __docshareServerHolder?: unknown }).__docshareServerHolder;
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
  process.env.DOCSHARE_CONFIG = alpha;
  const firstModule = await import("../../src/server/context");
  const firstContext = await firstModule.getServerContext();
  expect((await firstModule.getLiveRuntime()).context).toBe(firstContext);

  vi.resetModules();
  const reloadedModule = await import("../../src/server/context");
  expect(await reloadedModule.getServerContext()).toBe(firstContext);
  expect((await reloadedModule.getLiveRuntime()).context).toBe(firstContext);
  expect(start).toHaveBeenCalledTimes(1);

  process.env.DOCSHARE_CONFIG = await config("beta", "beta");
  const betaContext = await reloadedModule.getServerContext();
  const betaRuntime = await reloadedModule.getLiveRuntime();
  expect(betaContext).not.toBe(firstContext);
  expect(betaRuntime.context).toBe(betaContext);
  expect(close).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledTimes(2);
});

it("chains A to B to A teardown without starting a replacement early", async () => {
  const alpha = await config("alpha", "alpha");
  const beta = await config("beta", "beta");
  process.env.DOCSHARE_CONFIG = alpha;
  const server = await import("../../src/server/context");
  await server.getLiveRuntime();
  let releaseClose!: () => void;
  close.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseClose = resolve; }));

  process.env.DOCSHARE_CONFIG = beta;
  const betaRuntime = server.getLiveRuntime().catch(() => undefined);
  process.env.DOCSHARE_CONFIG = alpha;
  const finalAlpha = server.getLiveRuntime();
  await vi.waitFor(() => expect(releaseClose).toBeTypeOf("function"));
  expect(start).toHaveBeenCalledTimes(1);
  releaseClose();
  await Promise.all([betaRuntime, finalAlpha]);
  expect(start).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledTimes(1);
});

it("marks health connected only after the current path runtime starts", async () => {
  const { changeHub } = await import("../../src/live/change-hub");
  changeHub.publish({ kind: "status", status: "degraded" });
  process.env.DOCSHARE_CONFIG = await config("alpha", "alpha");
  const server = await import("../../src/server/context");
  await server.getLiveRuntime();
  const abort = new AbortController();
  const event = await changeHub.subscribe(abort.signal)[Symbol.asyncIterator]().next();
  expect(event.value).toEqual({ kind: "status", status: "connected" });
  abort.abort();
});
