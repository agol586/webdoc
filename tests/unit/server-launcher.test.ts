import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";

import { buildNextArgs, installChildShutdown } from "../../scripts/webdoc-server-args";

const execFileAsync = promisify(execFile);

it("uses the configured host and port for development", () => {
  expect(buildNextArgs("dev", { host: "0.0.0.0", port: 4321 })).toEqual([
    "dev", "--hostname", "0.0.0.0", "--port", "4321",
  ]);
});

it("uses the configured host and port for production", () => {
  expect(buildNextArgs("start", { host: "127.0.0.2", port: 9876 })).toEqual([
    "start", "--hostname", "127.0.0.2", "--port", "9876",
  ]);
});

it("loads the executable entry point before validating its mode", async () => {
  const result = await execFileAsync(resolve("node_modules/.bin/tsx"), ["scripts/webdoc-server.ts", "invalid"])
    .catch((error: unknown) => error as { stderr: string });
  expect(result.stderr).toContain("Usage: webdoc-server <dev|start>");
  expect(result.stderr).not.toContain("Top-level await");
});

it("force-stops a child that does not exit after Ctrl+C", () => {
  vi.useFakeTimers();
  try {
    const signals: NodeJS.Signals[] = [];
    const child = Object.assign(new EventEmitter(), {
      kill(signal: NodeJS.Signals) {
        signals.push(signal);
        return true;
      },
    });
    const parent = Object.assign(new EventEmitter(), { exitCode: undefined as number | undefined });

    installChildShutdown(child, parent, 100);
    parent.emit("SIGINT");
    expect(signals).toEqual(["SIGINT"]);

    vi.advanceTimersByTime(100);
    expect(signals).toEqual(["SIGINT", "SIGKILL"]);

    child.emit("exit", null, "SIGKILL");
    expect(parent.exitCode).toBe(130);
  } finally {
    vi.useRealTimers();
  }
});
