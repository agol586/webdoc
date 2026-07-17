import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { buildNextArgs } from "../../scripts/webdoc-server-args";

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
